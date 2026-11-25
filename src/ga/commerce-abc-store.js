// GA-015 — Evolução da Curva ABC por produto (somente leitura, só unidades). A função SQL commerce_abc_units_monthly_v1 traz as unidades por SKU
// em cada período; a GA-018 dá o último dia completo e a cobertura; a GA-019 e a GA-021 conciliam cada período com as MESMAS datas.
// Parte que falhar vira INDISPONIVEL e nada é classificado como confirmado. As regras ficam em commerce-abc-logic.js.
import { commerceRpc as supabaseRpc } from './commerce-rpc.js';
import { commerceDataQuality, commerceSalesDailySource, commerceShopeeSalesLinkSplit, findLastCompleteDay, saoPauloToday } from './commerce-supabase-store.js';
import { coverageProven } from './commerce-platform-scope-logic.js';
import { isAbcPlatform, isAbcMode, planPeriods, buildAbcEvolution, sumDailyRange, displayedSkus, attachNames, HISTORY_MONTHS } from './commerce-abc-logic.js';

// Orçamento de subrequisições do Worker (plano gratuito: 50 por pedido). 40 deixa folga de 10 para a autenticação e o roteamento.
// Pior caso (Shopee): 14 sondas do último dia completo + 1 fonte GA-019 + 1 unidades + 1 nomes + 2 coberturas + 2 divisões das janelas
// = 21 obrigatórias; o histórico mensal gasta o resto (2 por mês na Shopee: cobertura + divisão GA-021; 1 por mês no ML).
// O que não couber NÃO é consultado: o mês fica "não verificado nesta consulta" (nunca confirmado).
export const SUBREQUEST_BUDGET=40;

export async function commerceAbcNames(env,{skus}={}) {
  const data=await supabaseRpc(env,'commerce_abc_names_v1',{p_skus:skus},{timeoutMs:15000});
  return Array.isArray(data)?data:null;
}

export async function commerceAbcUnits(env,{platform,periods}={}) {
  const data=await supabaseRpc(env,'commerce_abc_units_monthly_v1',{p_platform:platform,p_periods:periods.map(p=>({key:p.key,start:p.start,end:p.end}))},{timeoutMs:25000});
  return data&&typeof data==='object'&&!Array.isArray(data)?data:null;
}

const monthShift=(day,n)=>{const [y,m]=day.slice(0,7).split('-').map(Number);const t=y*12+(m-1)+n;return String(Math.floor(t/12)).padStart(4,'0')+'-'+String(t%12+1).padStart(2,'0')+'-01';};

export async function commerceAbcEvolutionV1(env,{platform,mode,month}={},deps=null) {
  if(!isAbcPlatform(platform)||!isAbcMode(mode))throw new Error('Filtro da Evolução ABC inválido.');
  if(month!=null&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Mês da Evolução ABC inválido.');
  const d=deps||{units:commerceAbcUnits,names:commerceAbcNames,quality:commerceDataQuality,split:commerceShopeeSalesLinkSplit,source:commerceSalesDailySource,today:saoPauloToday};
  const t0=Date.now(),failed=[];
  const meter={used:0};
  const metered=fn=>(...a)=>{meter.used++;return fn(...a);}; // toda consulta ao banco passa por aqui
  const quality=metered(d.quality),units=metered(d.units),source=metered(d.source),splitFn=metered(d.split),namesFn=d.names?metered(d.names):null;
  const settle=async(name,fn)=>{try{return await fn();}catch{if(!failed.includes(name))failed.push(name);return null;}};
  const budget=()=>({limit:SUBREQUEST_BUDGET,used:meter.used});
  const today=d.today();
  // 1) Último dia completo comprovado pela GA-018 desta conta (as datas devolvidas são conferidas lá).
  const facts=await settle('window',()=>findLastCompleteDay(env,{platform,today,quality}));
  const last=facts?.last_complete_day||null;
  const meta=facts?{last_import_day:facts.last_import_day,last_import_at:facts.last_import_at,skipped:facts.skipped,probes:facts.probes}:null;
  if(!last)return {...buildAbcEvolution({platform,mode,today,last,plan:{error:facts?'SEM_ULTIMO_DIA_COMPLETO':'JANELA_INDISPONIVEL'}}),window:meta,failed,budget:budget(),elapsed_ms:Date.now()-t0};
  // 2) Fonte diária da GA-019 num único intervalo (mesmo intervalo serve a todos os períodos e dá a primeira data importada).
  const srcStart=monthShift(last,-(HISTORY_MONTHS+12));
  const rows=await settle('source',()=>source(env,{platform,start:srcStart,end:last}));
  const firstRow=Array.isArray(rows)?rows.filter(r=>r&&Number(r.units)>0&&typeof r.sale_date==='string').map(r=>r.sale_date.slice(0,10)).sort()[0]:null;
  const firstDay=firstRow&&firstRow>srcStart?firstRow:null; // se o dado começa no início do intervalo, o início real é desconhecido
  const plan=planPeriods({mode,last,firstDay,month});
  if(plan.error)return {...buildAbcEvolution({platform,mode,today,last,plan}),window:meta,failed,budget:budget(),elapsed_ms:Date.now()-t0};
  const all=[...plan.history,plan.current,...(plan.previous?[plan.previous]:[])];
  const cmpPeriods=[plan.current,...(plan.previous?[plan.previous]:[])];
  const rk=p=>p.start+'|'+p.end;
  // 3) Orçamento: as janelas da comparação sempre são consultadas; o histórico (do mês mais novo para trás) gasta o que sobrar.
  const shopee=platform==='SHOPEE',cmpKeys=new Set(cmpPeriods.map(rk));
  const mandatory=meter.used+1/*unidades*/+(namesFn?1:0)+cmpKeys.size*(shopee?2:1);
  let room=SUBREQUEST_BUDGET-mandatory;const checked=new Set(),skippedKeys=[];
  for(const p of plan.history.slice().reverse()){
    const cost=cmpKeys.has(rk(p))?0:(shopee?2:1);
    if(room>=cost){room-=cost;checked.add(p.key);}else skippedKeys.push(p.key);
  }
  // 4) Cobertura e divisão GA-021 com cache por intervalo (um mês igual à janela comparada não consulta de novo).
  const covCache=new Map(),splitCache=new Map();
  const cover=p=>{const k=rk(p);if(!covCache.has(k))covCache.set(k,settle('quality',()=>quality(env,{platform,start:p.start,end:p.end})).then(dq=>({proven:coverageProven(dq,platform,{start:p.start,end:p.end}),checked:!!dq})));return covCache.get(k);};
  const getSplit=p=>{const k=rk(p);if(!splitCache.has(k))splitCache.set(k,settle('split',()=>splitFn(env,{start:p.start,end:p.end})));return splitCache.get(k);};
  const coverage={};
  const toCover=[...cmpPeriods,...plan.history.filter(p=>checked.has(p.key))];
  const unitsP=settle('units',()=>units(env,{platform,periods:all}));
  const splitsP=shopee?Promise.all(toCover.map(p=>getSplit(p).then(sp=>[p.key,sp]))):Promise.resolve([]);
  const cmpP=Promise.all(cmpPeriods.map(async p=>{const c=await cover(p);coverage[p.key]=c.proven?'COMPLETA':'NAO_COMPROVADA';}));
  const histRes=Promise.all(plan.history.filter(p=>checked.has(p.key)).map(async p=>[p.key,await cover(p)]));
  const [data,splitPairs,,hist]=await Promise.all([unitsP,splitsP,cmpP,histRes]);
  // histórico: do mais novo para o mais antigo, para no primeiro mês não comprovado (os mais antigos ficam "não verificados")
  const hmap=new Map(hist);let stop=false;
  for(const p of plan.history.slice().reverse()){
    if(skippedKeys.includes(p.key)||stop){coverage[p.key]='NAO_VERIFICADA';continue;}
    const c=hmap.get(p.key);coverage[p.key]=c&&c.proven?'COMPLETA':'NAO_COMPROVADA';if(!c||!c.proven)stop=true;
  }
  const splits=Object.fromEntries(splitPairs.filter(([,sp])=>sp));
  const ga019={};
  for(const p of all)ga019[p.key]=Array.isArray(rows)?sumDailyRange(rows,p.start,p.end):null;
  const out=buildAbcEvolution({platform,mode,today,last,plan,data,ga019,coverage,splits,skipped:skippedKeys});
  // 5) Nomes só dos SKUs exibidos e só com vínculo confiável; falha aqui nunca bloqueia nada (ficam os códigos).
  let namesState='NAO_PEDIDOS';
  if(namesFn&&out.status==='OK'){
    const skus=displayedSkus(out);
    if(skus.length){const nm=await settle('names',()=>namesFn(env,{skus}));namesState=nm?'DISPONIVEL':'INDISPONIVEL';if(nm)attachNames(out,nm);}
  }
  return {...out,names_state:namesState,window:meta,failed,budget:{...budget(),history_checked:checked.size,history_skipped:skippedKeys.length},elapsed_ms:Date.now()-t0};
}
