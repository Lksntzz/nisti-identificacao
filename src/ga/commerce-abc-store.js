// GA-015 — Evolução da Curva ABC por produto (somente leitura, só unidades). A função SQL commerce_abc_units_monthly_v1 traz as unidades por SKU
// em cada período; a GA-018 dá o último dia completo e a cobertura; a GA-019 e a GA-021 conciliam cada período com as MESMAS datas.
// Parte que falhar vira INDISPONIVEL e nada é classificado como confirmado. As regras ficam em commerce-abc-logic.js.
import { commerceRpc as supabaseRpc } from './commerce-rpc.js';
import { commerceDataQuality, commerceSalesDailySource, commerceShopeeSalesLinkSplit, findLastCompleteDay, saoPauloToday } from './commerce-supabase-store.js';
import { coverageProven } from './commerce-platform-scope-logic.js';
import { isAbcPlatform, isAbcMode, planPeriods, buildAbcEvolution, sumDailyRange, dayAdd, HISTORY_MONTHS } from './commerce-abc-logic.js';

export async function commerceAbcUnits(env,{platform,periods}={}) {
  const data=await supabaseRpc(env,'commerce_abc_units_monthly_v1',{p_platform:platform,p_periods:periods.map(p=>({key:p.key,start:p.start,end:p.end}))},{timeoutMs:25000});
  return data&&typeof data==='object'&&!Array.isArray(data)?data:null;
}

const monthShift=(day,n)=>{const [y,m]=day.slice(0,7).split('-').map(Number);const t=y*12+(m-1)+n;return String(Math.floor(t/12)).padStart(4,'0')+'-'+String(t%12+1).padStart(2,'0')+'-01';};

export async function commerceAbcEvolutionV1(env,{platform,mode,month}={},deps=null) {
  if(!isAbcPlatform(platform)||!isAbcMode(mode))throw new Error('Filtro da Evolução ABC inválido.');
  if(month!=null&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Mês da Evolução ABC inválido.');
  const d=deps||{units:commerceAbcUnits,quality:commerceDataQuality,split:commerceShopeeSalesLinkSplit,source:commerceSalesDailySource,today:saoPauloToday};
  const t0=Date.now(),failed=[];
  const settle=async(name,fn)=>{try{return await fn();}catch{if(!failed.includes(name))failed.push(name);return null;}};
  const today=d.today();
  // 1) Último dia completo comprovado pela GA-018 desta conta (as datas devolvidas são conferidas lá).
  const facts=await settle('window',()=>findLastCompleteDay(env,{platform,today,quality:d.quality}));
  const last=facts?.last_complete_day||null;
  const meta=facts?{last_import_day:facts.last_import_day,last_import_at:facts.last_import_at,skipped:facts.skipped,probes:facts.probes}:null;
  if(!last)return {...buildAbcEvolution({platform,mode,today,last,plan:{error:facts?'SEM_ULTIMO_DIA_COMPLETO':'JANELA_INDISPONIVEL'}}),window:meta,failed,elapsed_ms:Date.now()-t0};
  // 2) Fonte diária da GA-019 num único intervalo (mesmo intervalo serve a todos os períodos e dá a primeira data importada).
  const srcStart=monthShift(last,-(HISTORY_MONTHS+12));
  const rows=await settle('source',()=>d.source(env,{platform,start:srcStart,end:last}));
  const firstRow=Array.isArray(rows)?rows.filter(r=>r&&Number(r.units)>0&&typeof r.sale_date==='string').map(r=>r.sale_date.slice(0,10)).sort()[0]:null;
  const firstDay=firstRow&&firstRow>srcStart?firstRow:null; // se o dado começa no início do intervalo, o início real é desconhecido
  const plan=planPeriods({mode,last,firstDay,month});
  if(plan.error)return {...buildAbcEvolution({platform,mode,today,last,plan}),window:meta,failed,elapsed_ms:Date.now()-t0};
  const all=[...plan.history,plan.current,...(plan.previous?[plan.previous]:[])];
  // 3) Unidades por SKU, conciliação e cobertura. Cobertura do histórico: do mês mais novo para trás, parando no primeiro não comprovado
  //    (os mais antigos ficam "não verificados", nunca comprovados). Janelas da comparação sempre são consultadas.
  const cache=new Map();
  const cover=(p)=>{const k=p.start+'|'+p.end;if(!cache.has(k))cache.set(k,settle('quality',()=>d.quality(env,{platform,start:p.start,end:p.end})).then(dq=>({proven:coverageProven(dq,platform,{start:p.start,end:p.end}),checked:!!dq,dq})));return cache.get(k);};
  const coverage={},checked={};
  const cmpPeriods=[plan.current,...(plan.previous?[plan.previous]:[])];
  const unitsP=settle('units',()=>d.units(env,{platform,periods:all}));
  const splitsP=platform==='SHOPEE'?Promise.all(all.map(p=>settle('split',()=>d.split(env,{start:p.start,end:p.end})).then(s=>[p.key,s]))):Promise.resolve([]);
  const cmpP=Promise.all(cmpPeriods.map(async p=>{const c=await cover(p);coverage[p.key]=c.proven?'COMPLETA':'NAO_COMPROVADA';checked[p.key]=c.checked;}));
  const histP=(async()=>{let stop=false;for(const p of plan.history.slice().reverse()){
    if(stop){coverage[p.key]='NAO_VERIFICADA';checked[p.key]=false;continue;}
    const c=await cover(p);coverage[p.key]=c.proven?'COMPLETA':'NAO_COMPROVADA';checked[p.key]=c.checked;if(!c.proven)stop=true;}})();
  const [data,splitPairs]=await Promise.all([unitsP,splitsP,cmpP,histP]).then(r=>[r[0],r[1]]);
  const splits=Object.fromEntries(splitPairs.filter(([,s])=>s));
  const ga019={};
  for(const p of all)ga019[p.key]=Array.isArray(rows)?sumDailyRange(rows,p.start,p.end):null;
  const out=buildAbcEvolution({platform,mode,today,last,plan,data,ga019,coverage,splits});
  return {...out,window:meta,failed,elapsed_ms:Date.now()-t0};
}
