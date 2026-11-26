// GA-015 — Evolução da Curva ABC por produto (somente leitura, só unidades). A função SQL commerce_abc_units_monthly_v1 traz as unidades por SKU
// em cada período; a GA-018 dá o último dia completo e a cobertura; a GA-019 e a GA-021 conciliam cada período com as MESMAS datas.
// Parte que falhar vira INDISPONIVEL e nada é classificado como confirmado. As regras ficam em commerce-abc-logic.js.
//
// GA-P01 — duas operações separadas, ambas com no máximo 3 consultas simultâneas ao banco:
//  1) commerceAbcEvolutionV1: indicadores, classes, concentração e migrações (janela atual x anterior). NÃO consulta o histórico mensal.
//  2) commerceAbcHistoryV1: histórico mensal e individual, pedido pela tela só quando precisa.
// As duas leem a versão dos dados (commerce_data_version_v1) no começo e no fim; se mudar no meio (importação), nada é entregue misturado.
import { commerceRpc as supabaseRpc } from './commerce-rpc.js';
import { commerceDataQuality, commerceSalesDailySource, commerceShopeeSalesLinkSplit, commerceDataVersion, findLastCompleteDay, saoPauloToday } from './commerce-supabase-store.js';
import { coverageProven } from './commerce-platform-scope-logic.js';
import { isAbcPlatform, isAbcMode, planPeriods, buildAbcEvolution, buildAbcHistory, historyMonthsOf, sumDailyRange, displayedSkus, attachNames, HISTORY_MONTHS, LIST_LIMIT } from './commerce-abc-logic.js';
import { makeLimiter, MAX_PARALLEL_DB } from './commerce-concurrency.js';

// Orçamento de subrequisições do Worker (plano gratuito: 50 por pedido). 40 deixa folga de 10 para a autenticação e o roteamento.
// Indicadores, pior caso (Shopee): 14 sondas do último dia completo + 2 leituras da versão + 1 fonte GA-019 + 1 unidades + 1 nomes
// + 2 coberturas + 2 divisões das janelas = 23. Histórico: 2 versões + 1 fonte + 1 unidades + até 2 por mês (cobertura + divisão GA-021) = 28.
// O que não couber NÃO é consultado: o mês fica "não verificado nesta consulta" (nunca confirmado).
export const SUBREQUEST_BUDGET=40;

export async function commerceAbcNames(env,{platform,skus}={}) {
  const data=await supabaseRpc(env,'commerce_abc_names_v1',{p_platform:platform,p_skus:skus},{timeoutMs:15000});
  return Array.isArray(data)?data:null;
}

export async function commerceAbcUnits(env,{platform,periods}={}) {
  const data=await supabaseRpc(env,'commerce_abc_units_monthly_v1',{p_platform:platform,p_periods:periods.map(p=>({key:p.key,start:p.start,end:p.end}))},{timeoutMs:25000});
  return data&&typeof data==='object'&&!Array.isArray(data)?data:null;
}

const monthShift=(day,n)=>{const [y,m]=day.slice(0,7).split('-').map(Number);const t=y*12+(m-1)+n;return String(Math.floor(t/12)).padStart(4,'0')+'-'+String(t%12+1).padStart(2,'0')+'-01';};
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;
const validDay=v=>{if(typeof v!=='string'||!ISO_DAY.test(v))return false;const t=Date.parse(v+'T00:00:00Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===v;};
const validMonth=m=>m==null||/^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const realDeps=()=>({units:commerceAbcUnits,names:commerceAbcNames,quality:commerceDataQuality,split:commerceShopeeSalesLinkSplit,source:commerceSalesDailySource,version:commerceDataVersion,today:saoPauloToday});

// Uma operação = um medidor + um limitador. Toda consulta ao banco passa por aqui: é contada e nunca passa de MAX_PARALLEL_DB ao mesmo tempo.
function operation(d){
  const t0=Date.now(),failed=[],meter={used:0},run=makeLimiter(MAX_PARALLEL_DB),phases={},limit=Number.isInteger(d.budget)&&d.budget>0?d.budget:SUBREQUEST_BUDGET; // d.budget só existe nos testes
  const metered=fn=>fn?(...a)=>{meter.used++;return run(()=>fn(...a));}:null;
  const settle=async(name,fn)=>{try{return await fn();}catch{if(!failed.includes(name))failed.push(name);return null;}};
  const timed=async(name,fn)=>{const s=Date.now();try{return await fn();}finally{phases[name]=Date.now()-s;}};
  return {t0,failed,meter,phases,settle,timed,
    quality:metered(d.quality),units:metered(d.units),source:metered(d.source),split:metered(d.split),names:metered(d.names),version:metered(d.version),
    budget:()=>({limit,used:meter.used,max_parallel:MAX_PARALLEL_DB}),
    metrics:extra=>({elapsed_ms:Date.now()-t0,queries:meter.used,failed:failed.slice(),failed_count:failed.length,phases_ms:{...phases},...extra})};
}

// Lê a versão dos dados. Falha de leitura = versão desconhecida (null): o histórico não é liberado sem versão provada.
const readVersion=(op,env)=>op.version?op.settle('version',()=>op.version(env)):Promise.resolve(null);

export async function commerceAbcEvolutionV1(env,{platform,mode,month}={},deps=null) {
  if(!isAbcPlatform(platform)||!isAbcMode(mode))throw new Error('Filtro da Evolução ABC inválido.');
  if(!validMonth(month))throw new Error('Mês da Evolução ABC inválido.');
  const d=deps||realDeps();
  const op=operation(d);
  const {settle,timed}=op;
  const version0=await timed('version',()=>readVersion(op,env));
  // Sem versão legível no começo a consistência não pode ser provada: nada é consultado nem confirmado (a tela oferece tentar de novo).
  if(!version0)return {status:'VERSAO_INDISPONIVEL',reason:'VERSAO_ILEGIVEL_NO_INICIO',platform,mode,data_version:null,failed:op.failed,budget:op.budget(),elapsed_ms:Date.now()-op.t0,metrics:op.metrics()};
  const today=d.today();
  // 1) Último dia completo comprovado pela GA-018 desta conta (as datas devolvidas são conferidas lá). Sondas de 3 em 3 dias, lidas em ordem.
  const facts=await timed('window',()=>settle('window',()=>findLastCompleteDay(env,{platform,today,quality:op.quality,concurrency:MAX_PARALLEL_DB})));
  const last=facts?.last_complete_day||null;
  const meta=facts?{last_import_day:facts.last_import_day,last_import_at:facts.last_import_at,skipped:facts.skipped,probes:facts.probes}:null;
  const done=body=>({...body,data_version:version0,window:meta,failed:op.failed,budget:op.budget(),elapsed_ms:Date.now()-op.t0,metrics:op.metrics()});
  if(!last)return done(buildAbcEvolution({platform,mode,today,last,plan:{error:facts?'SEM_ULTIMO_DIA_COMPLETO':'JANELA_INDISPONIVEL'}}));
  // 2) Fonte diária da GA-019 num único intervalo (dá a primeira data importada e as somas das duas janelas).
  const srcStart=monthShift(last,-(HISTORY_MONTHS+12));
  const rows=await timed('source',()=>settle('source',()=>op.source(env,{platform,start:srcStart,end:last})));
  const firstRow=Array.isArray(rows)?rows.filter(r=>r&&Number(r.units)>0&&typeof r.sale_date==='string').map(r=>r.sale_date.slice(0,10)).sort()[0]:null;
  const firstDay=firstRow&&firstRow>srcStart?firstRow:null; // se o dado começa no início do intervalo, o início real é desconhecido
  const full=planPeriods({mode,last,firstDay,month});
  if(full.error)return done(buildAbcEvolution({platform,mode,today,last,plan:full}));
  const plan={...full,history:[]};                       // indicadores: sem os 12 meses
  const cmpPeriods=[plan.current,...(plan.previous?[plan.previous]:[])];
  const shopee=platform==='SHOPEE';
  // 3) Só as janelas da comparação: unidades, cobertura e (Shopee) divisão GA-021. O limitador mantém no máximo 3 em andamento.
  const coverage={},splits={};
  const [data]=await timed('main',()=>{
    const unitsP=settle('units',()=>op.units(env,{platform,periods:cmpPeriods}));
    const perPeriod=cmpPeriods.map(async p=>{
      const [dq,sp]=await Promise.all([
        settle('quality',()=>op.quality(env,{platform,start:p.start,end:p.end})),
        shopee?settle('split',()=>op.split(env,{start:p.start,end:p.end})):Promise.resolve(null)]);
      coverage[p.key]=coverageProven(dq,platform,{start:p.start,end:p.end})?'COMPLETA':'NAO_COMPROVADA';
      if(sp)splits[p.key]=sp;
    });
    return Promise.all([unitsP,Promise.all(perPeriod)]);
  });
  const ga019={};
  for(const p of cmpPeriods)ga019[p.key]=Array.isArray(rows)?sumDailyRange(rows,p.start,p.end):null;
  const out=buildAbcEvolution({platform,mode,today,last,plan,data,ga019,coverage,splits});
  // 4) Nomes só dos SKUs exibidos e só com vínculo confiável; falha aqui nunca bloqueia nada (ficam os códigos).
  let namesState='NAO_PEDIDOS';
  if(op.names&&out.status==='OK'){
    const skus=displayedSkus(out);
    if(skus.length){const nm=await timed('names',()=>settle('names',()=>op.names(env,{platform,skus})));namesState=nm?'DISPONIVEL':'INDISPONIVEL';if(nm)attachNames(out,nm);}
  }
  // 5) A versão dos dados tem de ser a mesma do começo: importação no meio da consulta = nada é entregue (a tela pede de novo).
  const version1=await timed('version_end',()=>readVersion(op,env));
  if(!version1)
    return {status:'VERSAO_INDISPONIVEL',reason:'VERSAO_ILEGIVEL_NO_FIM',platform,mode,data_version:null,failed:op.failed,budget:op.budget(),elapsed_ms:Date.now()-op.t0,metrics:op.metrics()};
  if(version1!==version0)
    return {status:'VERSAO_ALTERADA',reason:'IMPORTACAO_DURANTE_CONSULTA',platform,mode,data_version:version1,failed:op.failed,budget:op.budget(),elapsed_ms:Date.now()-op.t0,metrics:op.metrics()};
  return done({...out,names_state:namesState,history_state:'SOB_DEMANDA',history_months:historyMonthsOf(full)});
}

// Histórico mensal e individual (12 meses) sob demanda. Entrada: o último dia completo e a versão que os indicadores devolveram, e os SKUs exibidos.
// Se a versão dos dados de agora não for a recebida (importação entre os dois pedidos), responde VERSAO_ALTERADA e não calcula nada.
export async function commerceAbcHistoryV1(env,{platform,mode,month,last,dataVersion,skus}={},deps=null) {
  if(!isAbcPlatform(platform)||!isAbcMode(mode))throw new Error('Filtro da Evolução ABC inválido.');
  if(!validMonth(month))throw new Error('Mês da Evolução ABC inválido.');
  if(!validDay(last))throw new Error('Último dia completo inválido.');
  if(typeof dataVersion!=='string'||!dataVersion||dataVersion.length>200)throw new Error('Versão dos dados inválida.');
  if(!Array.isArray(skus)||skus.length>LIST_LIMIT||skus.some(s=>typeof s!=='string'||!s||s.length>120))throw new Error('Lista de SKUs inválida.');
  const d=deps||realDeps();
  const op=operation(d);
  const {settle,timed}=op;
  const echo={platform,mode,month:month||null,last_complete_day:last};
  const stop=(status,version)=>({status,...echo,data_version:version??null,failed:op.failed,budget:op.budget(),elapsed_ms:Date.now()-op.t0,metrics:op.metrics()});
  const version0=await timed('version',()=>readVersion(op,env));
  if(!version0)return stop('VERSAO_INDISPONIVEL',null);       // sem provar a versão, não entrega histórico
  if(version0!==dataVersion)return stop('VERSAO_ALTERADA',version0);
  const srcStart=monthShift(last,-(HISTORY_MONTHS+12));
  const rows=await timed('source',()=>settle('source',()=>op.source(env,{platform,start:srcStart,end:last})));
  const firstRow=Array.isArray(rows)?rows.filter(r=>r&&Number(r.units)>0&&typeof r.sale_date==='string').map(r=>r.sale_date.slice(0,10)).sort()[0]:null;
  const firstDay=firstRow&&firstRow>srcStart?firstRow:null;
  const plan=planPeriods({mode,last,firstDay,month});
  if(plan.error)return {...stop('INDISPONIVEL',version0),reason:plan.error};
  const months=plan.history,shopee=platform==='SHOPEE';
  const unitsP=settle('units',()=>op.units(env,{platform,periods:months})); // 1 consulta com todos os meses; corre junto com as coberturas (limite de 3 no total)
  // Cobertura GA-018 do mais novo para o mais antigo, 3 meses por vez; para no primeiro mês não comprovado (os mais antigos ficam "não verificados").
  // A divisão GA-021 (Shopee) é consultada em todos os meses, como antes, porque a conciliação de cada mês depende dela.
  const coverage={},splits={},skipped=[];let stopped=false;
  const newest=months.slice().reverse();
  for(let i=0;i<newest.length;i+=MAX_PARALLEL_DB){
    const batch=newest.slice(i,i+MAX_PARALLEL_DB);
    // orçamento: o que não couber não é consultado e fica "não verificado nesta consulta"
    const room=op.budget().limit-op.meter.used-1/*versão final*/; // a consulta de unidades já foi contada ao ser disparada
    const need=batch.reduce((n,p)=>n+(stopped?0:1)+(shopee?1:0),0);
    if(need>room){for(const p of batch)skipped.push(p.key);continue;}
    await timed('history_batch_'+(i/MAX_PARALLEL_DB+1),()=>Promise.all(batch.map(async p=>{
      const [dq,sp]=await Promise.all([
        stopped?Promise.resolve(undefined):settle('quality',()=>op.quality(env,{platform,start:p.start,end:p.end})),
        shopee?settle('split',()=>op.split(env,{start:p.start,end:p.end})):Promise.resolve(null)]);
      if(dq!==undefined)coverage[p.key]={dq,proven:coverageProven(dq,platform,{start:p.start,end:p.end})};
      if(sp)splits[p.key]=sp;
    })));
    for(const p of batch)if(coverage[p.key]&&!coverage[p.key].proven)stopped=true; // primeiro não comprovado (do mais novo): os próximos lotes não consultam cobertura
  }
  const data=await unitsP;
  // cobertura final: comprovada, não comprovada, ou "não verificada" (depois do primeiro não comprovado ou fora do orçamento)
  const cov={};let seenUnproven=false;
  for(const p of newest){
    if(skipped.includes(p.key)||seenUnproven||!coverage[p.key]){cov[p.key]='NAO_VERIFICADA';continue;}
    cov[p.key]=coverage[p.key].proven?'COMPLETA':'NAO_COMPROVADA';
    if(!coverage[p.key].proven)seenUnproven=true;
  }
  const ga019={};
  for(const p of months)ga019[p.key]=Array.isArray(rows)?sumDailyRange(rows,p.start,p.end):null;
  const built=buildAbcHistory({platform,history:months,data,ga019,coverage:cov,splits,skipped,skus});
  const version1=await timed('version_end',()=>readVersion(op,env));
  if(!version1||version1!==version0)return stop(version1?'VERSAO_ALTERADA':'VERSAO_INDISPONIVEL',version1);
  const checked=months.filter(p=>!skipped.includes(p.key)&&coverage[p.key]).length;
  return {status:'OK',...echo,data_version:version0,...built,
    failed:op.failed,budget:{...op.budget(),history_checked:checked,history_skipped:skipped.length},elapsed_ms:Date.now()-op.t0,metrics:op.metrics()};
}
