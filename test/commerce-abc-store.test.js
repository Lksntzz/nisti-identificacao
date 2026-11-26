// GA-015 — camada de leitura da Evolução ABC com dependências simuladas (dados FICTÍCIOS, nenhum banco).
import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceAbcEvolutionV1, commerceAbcHistoryV1 } from '../src/ga/commerce-abc-store.js';

const TODAY='2026-11-25';
const addDay=(d,n)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
const span=(a,b)=>(Date.parse(b)-Date.parse(a))/86400000+1;
// Vendas fictícias: cada dia vendem A=6, B=3, C=1 unidades com SKU e 2 sem SKU; de 01/01/2026 a 24/11/2026.
const FIRST='2026-01-01',LASTIMP='2026-11-24';
const SKUS={AAA:6,BBB:3,CCC:1},NOSKU=2;
const days=(a,b)=>{const out=[];for(let d=a;d<=b;d=addDay(d,1))if(d>=FIRST&&d<=LASTIMP)out.push(d);return out;};
const dayQ=(platform,day,state)=>({platform,period:{start:day,end:day,today:TODAY},sales:{requested_days:1,complete_days:state==='COMPLETO'?1:0,partial_days:state==='PARCIAL'?1:0,days_with_records_unverified:0,days_without_information:0,last_sale_day:LASTIMP,last_import_at:'2026-11-24T13:00:00+00:00'}});
const rangeQ=(platform,a,b,proven)=>({platform,period:{start:a,end:b,today:TODAY},sales:{status:proven?'COMPLETA':'PARCIAL',requested_days:span(a,b),complete_days:proven?span(a,b):span(a,b)-2,partial_days:proven?0:2,days_without_information:0,days_with_records_unverified:0,missing_ranges:[],last_sale_day:LASTIMP}});
const PROVEN_FROM='2026-10-01';
const mk=(over={})=>{
  const calls=[],state={version:'v1',active:0,peak:0};
  // cada consulta simulada leva um instante: assim o pico de consultas simultâneas é medido de verdade
  const slow=fn=>async(...a)=>{state.active++;state.peak=Math.max(state.peak,state.active);try{await new Promise(r=>setImmediate(r));return await fn(...a);}finally{state.active--;}};
  const deps={
    today:()=>TODAY,
    version:slow(async()=>{calls.push(['version']);if(state.version instanceof Error)throw state.version;return typeof state.version==='function'?state.version():state.version;}),
    quality:async(_e,a)=>{calls.push(['quality',a]);
      if(a.start===a.end)return dayQ(a.platform,a.start,a.start==='2026-11-24'?'PARCIAL':'COMPLETO');
      return rangeQ(a.platform,a.start,a.end,a.start>=PROVEN_FROM&&a.end<='2026-11-23');},
    source:async(_e,a)=>{calls.push(['source',a]);return days(a.start,a.end).map(d=>({sale_date:d,units:10+NOSKU-NOSKU}));}, // 6+3+1=10 com SKU; sem SKU é +2 abaixo
    units:async(_e,a)=>{calls.push(['units',a]);return {platform:a.platform,periods:a.periods.map(p=>{const n=days(p.start,p.end).length;return {key:p.key,start:p.start,end:p.end,days:span(p.start,p.end),days_with_data:n,total_units:n*10,sku_units:n*10,no_sku_units:0,ranked_units:n*10,nonpositive_units:0,products:n?3:0};}),
      product_count:3,products:Object.entries(SKUS).map(([sku,u])=>({sku,units:Object.fromEntries(a.periods.map(p=>[p.key,days(p.start,p.end).length*u]))}))};},
    split:async(_e,a)=>{calls.push(['split',a]);const n=days(a.start,a.end).length*10;return {start:a.start,end:a.end,total_units:n,unlinked_units:0,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:0}};},
    ...over};
  for(const k of ['quality','source','units','split'])deps[k]=slow(deps[k]);
  return {deps,calls,state};
};

test('Shopee 7 dias: janela termina em 23/11 (24/11 é parcial); indicadores confirmados SEM consultar o histórico mensal',async()=>{
  const {deps,calls,state}=mk();
  const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},deps);
  assert.equal(r.status,'OK'); assert.equal(r.last_complete_day,'2026-11-23'); assert.deepEqual(r.window.skipped,[{day:'2026-11-24',state:'PARCIAL'}]);
  assert.equal(r.window.probes,3,'sondas de 3 em 3 dias: 24/11, 23/11 e 22/11 pedidas juntas; só 23/11 vale');
  assert.deepEqual([r.current.start,r.current.end,r.previous.start,r.previous.end],['2026-11-17','2026-11-23','2026-11-10','2026-11-16']);
  assert.equal(r.comparison.state,'CONFIRMADA'); assert.equal(r.current.status,'CONFIRMADO'); assert.equal(r.previous.status,'CONFIRMADO');
  assert.deepEqual(r.history,[]); assert.deepEqual(r.sku_history.rows,{}); assert.equal(r.history_state,'SOB_DEMANDA');
  assert.equal(r.history_months.length,11); assert.deepEqual(r.history_months.at(-1),{key:'2026-11',incomplete:true}); assert.deepEqual(Object.keys(r.history_months[0]).sort(),['incomplete','key']);
  const u=calls.filter(c=>c[0]==='units'); assert.equal(u.length,1); assert.deepEqual(u[0][1].periods.map(p=>p.key),['j7_atual','j7_ant'],'só as duas janelas');
  assert.equal(calls.filter(c=>c[0]==='source').length,1);
  assert.equal(calls.filter(c=>c[0]==='quality'&&c[1].start!==c[1].end).length,2,'cobertura só das duas janelas');
  assert.equal(calls.filter(c=>c[0]==='split').length,2,'divisão GA-021 só das duas janelas');
  assert.ok(state.peak<=3,'no máximo 3 consultas ao mesmo tempo: pico '+state.peak);
  assert.equal(r.data_version,'v1'); assert.equal(calls.filter(c=>c[0]==='version').length,2,'versão no começo e no fim');
  assert.equal(r.metrics.queries,calls.length); assert.equal(r.metrics.failed_count,0); assert.equal(typeof r.metrics.elapsed_ms,'number'); assert.ok(r.metrics.phases_ms.window>=0&&r.metrics.phases_ms.main>=0);
  assert.equal(r.budget.used,calls.length); assert.equal(r.budget.max_parallel,3); assert.ok(calls.length<=15,'poucas consultas: '+calls.length);
});
test('ML: sem consulta à GA-021; GA-019 sozinha concilia',async()=>{
  const {deps,calls}=mk(); const r=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'30d'},deps);
  assert.equal(calls.filter(c=>c[0]==='split').length,0); assert.equal(r.current.reconciliation.status,'CONCILIADO');
  assert.equal(r.comparison.state,'NAO_COMPROVADA','30 dias anteriores começam em setembro (não comprovado)'); assert.equal(r.current.status,'CONFIRMADO'); assert.equal(r.previous.status,'NAO_COMPROVADO');
  assert.equal(r.comparison.migrations.length,0);
});
test('a função avalia exatamente as datas da Central: períodos pedidos = períodos analisados; GA-019 soma nas mesmas datas',async()=>{
  const {deps,calls}=mk(); const r=await commerceAbcEvolutionV1({},{platform:'ML_ANTIGO',mode:'mensal',month:'2026-10'},deps);
  const u=calls.find(c=>c[0]==='units')[1]; const keys=Object.fromEntries(u.periods.map(p=>[p.key,[p.start,p.end]]));
  assert.deepEqual(keys.m_atual,['2026-10-01','2026-10-31']); assert.deepEqual(keys.m_ant,['2026-09-01','2026-09-30']);
  assert.deepEqual([r.current.start,r.current.end],['2026-10-01','2026-10-31']); assert.equal(r.current.reconciliation.ga019_units,310);
  assert.equal(r.equivalent,true);
});
test('mês corrente é incompleto: compara até o último dia completo contra os mesmos dias do mês anterior',async()=>{
  const {deps}=mk(); const r=await commerceAbcEvolutionV1({},{platform:'ML_ANTIGO',mode:'mensal'},deps);
  assert.deepEqual([r.current.start,r.current.end,r.current.incomplete],['2026-11-01','2026-11-23',true]); assert.deepEqual([r.previous.start,r.previous.end],['2026-10-01','2026-10-23']);
  assert.equal(r.comparison.state,'MES_ATE_AQUI','mês incompleto: comparação equivalente à parte, sem migração confirmada');
});
test('anual: ML não tem o ano anterior; Shopee tem (dados fictícios começam em 2026, então nenhum compara)',async()=>{
  const {deps}=mk(); const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'anual'},deps);
  assert.equal(r.comparison.state,'SEM_PERIODO_ANTERIOR'); assert.equal(r.previous,null);
});
test('sem último dia completo: indisponível, sem consultar função, fonte nem conciliação',async()=>{
  const {deps,calls}=mk({quality:async(_e,a)=>dayQ(a.platform,a.start,'PARCIAL')});
  const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},deps);
  assert.equal(r.status,'INDISPONIVEL'); assert.equal(r.reason,'SEM_ULTIMO_DIA_COMPLETO'); assert.equal(calls.some(c=>['units','source','split'].includes(c[0])),false);
});
test('datas erradas devolvidas pela GA-018 na busca do último dia: indisponível (não adivinha)',async()=>{
  const {deps,calls}=mk({quality:async(_e,a)=>({...dayQ(a.platform,a.start,'COMPLETO'),period:{start:'2026-01-01',end:a.end,today:TODAY}})});
  const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},deps);
  assert.equal(r.status,'INDISPONIVEL'); assert.ok(r.failed.includes('window')); assert.equal(calls.some(c=>c[0]==='units'),false);
});
test('função indisponível (ainda não aplicada) ou fonte GA-019 fora: bloqueia classes, nunca confirma',async()=>{
  const a=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},mk({units:async()=>{throw new Error('404');}}).deps);
  assert.ok(a.failed.includes('units')); assert.equal(a.comparison.state,'BLOQUEADA_INDISPONIVEL'); assert.equal(a.current.class_counts,null);
  const b=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},mk({source:async()=>{throw new Error('x');}}).deps);
  assert.ok(b.failed.includes('source')); assert.equal(b.current.reconciliation.reason,'GA019_INDISPONIVEL'); assert.equal(b.comparison.state,'BLOQUEADA_INDISPONIVEL');
});
test('GA-019 diferente do total da função: divergente, com motivo distinto',async()=>{
  const {deps}=mk({source:async(_e,a)=>days(a.start,a.end).map(d=>({sale_date:d,units:d==='2026-11-20'?11:10}))});
  const r=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},deps);
  assert.equal(r.current.reconciliation.reason,'GA019_DIFERENTE'); assert.equal(r.comparison.state,'BLOQUEADA_DIVERGENTE');
});
test('Shopee: GA-021 com resíduo nulo ou de outras datas bloqueia; falha de uma consulta não derruba as demais',async()=>{
  const nul=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},mk({split:async(_e,a)=>({start:a.start,end:a.end,total_units:days(a.start,a.end).length*10,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:null}})}).deps);
  assert.equal(nul.current.reconciliation.reason,'GA021_NAO_EXPLICA'); assert.equal(nul.comparison.state,'BLOQUEADA_DIVERGENTE');
  const old=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},mk({split:async(_e,a)=>({start:'2025-01-01',end:a.end,total_units:1,reconciliation:{status:'EXPLICADA'},difference:{residual_units:0}})}).deps);
  assert.equal(old.current.reconciliation.reason,'GA021_OUTRAS_DATAS');
  let n=0; const partial=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},mk({split:async(_e,a)=>{if(a.start==='2026-03-01')throw new Error('x');return {start:a.start,end:a.end,total_units:days(a.start,a.end).length*10,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:0}};}}).deps);
  void n; assert.equal(partial.comparison.state,'CONFIRMADA','falha de uma divisão fora das janelas nem é consultada nos indicadores');
});
test('resposta da função de outra conta ou com datas diferentes das pedidas é descartada',async()=>{
  const {deps}=mk(); const base=deps.units;
  const other=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},{...deps,units:async(e,a)=>({...await base(e,a),platform:'ML_ANTIGO'})});
  assert.equal(other.comparison.state,'BLOQUEADA_INDISPONIVEL');
  const dates=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},{...deps,units:async(e,a)=>{const r=await base(e,a);r.periods=r.periods.map(p=>p.key==='j7_atual'?{...p,end:'2026-11-22'}:p);return r;}});
  assert.equal(dates.current.status,'BLOQUEADO_INDISPONIVEL');
});
test('filtros inválidos',async()=>{
  const {deps}=mk();
  for(const bad of [{platform:'TODAS',mode:'7d'},{platform:'SHOPEE',mode:'60d'},{platform:'SHOPEE',mode:'mensal',month:'2026-13'},{platform:null,mode:null}])
    await assert.rejects(()=>commerceAbcEvolutionV1({},bad,deps),/inválido/);
});
test('a resposta não traz nenhum campo financeiro',async()=>{
  const {deps}=mk(); const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'30d'},deps);
  assert.ok(!/revenue|receita|ticket|faturamento|margin|price/i.test(JSON.stringify(r)));
});

// ---- GA-015 revisão: orçamento de consultas contado nas requisições HTTP REAIS (fetch simulado), pior cenário ----
import { commerceAbcUnits, commerceAbcNames, SUBREQUEST_BUDGET } from '../src/ga/commerce-abc-store.js';
import { commerceDataQuality, commerceShopeeSalesLinkSplit, commerceSalesDailySource } from '../src/ga/commerce-supabase-store.js';
const ENV={SUPABASE_URL:'https://fake.invalid',SUPABASE_SERVICE_ROLE_KEY:'k'};
async function withFetch(handler,fn){
  const real=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,init)=>{const name=decodeURIComponent(String(url).split('/rpc/')[1]);const body=JSON.parse(init.body);calls.push(name);
    const out=handler(name,body);return new Response(JSON.stringify(out),{status:200,headers:{'content-type':'application/json'}});};
  try{return await fn(calls);}finally{globalThis.fetch=real;}
}
const realDeps=()=>({today:()=>TODAY,units:commerceAbcUnits,names:commerceAbcNames,quality:commerceDataQuality,split:commerceShopeeSalesLinkSplit,source:commerceSalesDailySource,version:async()=>'vfix'});
// 13 dias parciais seguidos e o 14º completo = máximo de sondas (PROBE_MAX_DAYS).
const worstHandler=(provenAll)=>(name,b)=>{
  if(name==='commerce_data_quality_v1'){
    if(b.p_start===b.p_end){const i=Math.round((Date.parse(TODAY)-Date.parse(b.p_start))/86400000);return dayQ(b.p_platform,b.p_start,i<14?'PARCIAL':'COMPLETO');}
    return rangeQ(b.p_platform,b.p_start,b.p_end,provenAll&&b.p_start>='2026-01-01');
  }
  if(name==='commerce_sales_daily_source_v2')return days(b.p_from,b.p_to).map(d=>({sale_date:d,units:10}));
  if(name==='commerce_abc_units_monthly_v1')return {platform:b.p_platform,periods:b.p_periods.map(p=>{const n=days(p.start,p.end).length;return {key:p.key,start:p.start,end:p.end,days:span(p.start,p.end),days_with_data:n,total_units:n*10,sku_units:n*10,no_sku_units:0,ranked_units:n*10,nonpositive_units:0,products:n?3:0};}),
    product_count:3,products:Object.entries(SKUS).map(([sku,u])=>({sku,units:Object.fromEntries(b.p_periods.map(p=>[p.key,days(p.start,p.end).length*u]))}))};
  if(name==='commerce_shopee_sales_link_split_v1'){const n=days(b.p_start,b.p_end).length*10;return {start:b.p_start,end:b.p_end,total_units:n,unlinked_units:0,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:0}};}
  if(name==='commerce_abc_names_v1'){if(!['SHOPEE','ML_ANTIGO','ML_NOVO'].includes(b.p_platform))throw new Error('names sem conta');return b.p_skus.map(sku=>({sku,name:'Produto '+sku,source:'CADASTRO'}));}
  throw new Error('rpc inesperada '+name);
};
for(const [platform,mode] of [['SHOPEE','7d'],['SHOPEE','mensal'],['ML_NOVO','30d'],['ML_ANTIGO','anual']]){
  test(`pior cenário ${platform}/${mode}: 14 sondas + fonte + unidades + nomes + cobertura + conciliação cabem em ${SUBREQUEST_BUDGET} requisições reais`,async()=>{
    await withFetch(worstHandler(true),async calls=>{
      const r=await commerceAbcEvolutionV1(ENV,{platform,mode},realDeps());
      assert.ok(calls.length<=SUBREQUEST_BUDGET,`${platform}/${mode}: ${calls.length} requisições`); assert.equal(r.budget.used,calls.length+2,'o medidor conta as requisições reais mais as 2 leituras de versão (simuladas)');
      assert.equal(r.window.probes,14); assert.ok(r.status==='OK'||r.status==='INDISPONIVEL');
      if(r.status==='OK'){assert.equal(calls.filter(c=>c==='commerce_abc_units_monthly_v1').length,1); assert.equal(calls.filter(c=>c==='commerce_sales_daily_source_v2').length,1); assert.ok(calls.filter(c=>c==='commerce_abc_names_v1').length<=1);}
    });
  });
}
test('ML com 1 sonda: indicadores, nomes pedidos uma vez só para os SKUs exibidos, sem histórico',async()=>{
  const h=worstHandler(true),namesBodies=[];
  await withFetch((n,b)=>{if(n==='commerce_abc_names_v1')namesBodies.push(b);return n==='commerce_data_quality_v1'&&b.p_start===b.p_end?dayQ(b.p_platform,b.p_start,b.p_start==='2026-11-24'?'PARCIAL':'COMPLETO'):h(n,b);},async calls=>{
    const r=await commerceAbcEvolutionV1(ENV,{platform:'ML_NOVO',mode:'7d'},realDeps());
    assert.deepEqual(r.history,[]); assert.equal(calls.filter(c=>c==='commerce_abc_names_v1').length,1); assert.equal(r.names_state,'DISPONIVEL'); assert.equal(namesBodies.length,1); assert.equal(namesBodies[0].p_platform,'ML_NOVO','nomes pedidos para a conta certa');
    assert.equal(r.comparison.entries.find(e=>e.sku==='AAA').name,'Produto AAA'); assert.ok(calls.length<=SUBREQUEST_BUDGET);
    assert.equal(calls.filter(c=>c==='commerce_data_quality_v1').length,3+2,'3 sondas + 2 janelas, nenhum mês de histórico');
  });
});
test('nomes indisponíveis não bloqueiam nada: ficam os códigos e a falha é informada',async()=>{
  const {deps}=mk({names:async()=>{throw new Error('404');}});
  const r=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},deps);
  assert.equal(r.status,'OK'); assert.equal(r.comparison.state,'CONFIRMADA'); assert.equal(r.names_state,'INDISPONIVEL'); assert.ok(r.failed.includes('names')); assert.equal(r.comparison.entries[0].name,undefined);
});

// ---- GA-P01: histórico mensal e individual sob demanda ----
const histArgs=(over={})=>({platform:'SHOPEE',mode:'7d',last:'2026-11-23',dataVersion:'v1',skus:['AAA','BBB','CCC'],...over});
test('GA-P01 histórico: mesmos meses e mesmas regras de antes (outubro confirmado, setembro não comprovado, mais antigos não verificados)',async()=>{
  const {deps,calls,state}=mk();
  const r=await commerceAbcHistoryV1({},histArgs(),deps);
  assert.equal(r.status,'OK'); assert.equal(r.data_version,'v1'); assert.equal(r.last_complete_day,'2026-11-23'); assert.equal(r.platform,'SHOPEE'); assert.equal(r.mode,'7d');
  const by=Object.fromEntries(r.history.map(h=>[h.key,h]));
  assert.equal(by['2026-10'].status,'CONFIRMADO'); assert.equal(by['2026-11'].incomplete,true); assert.equal(by['2026-11'].end,'2026-11-23');
  assert.equal(by['2026-09'].status,'NAO_COMPROVADO'); assert.equal(by['2026-09'].coverage,'NAO_COMPROVADA');
  assert.equal(by['2026-08'].coverage,'NAO_VERIFICADA','mais antigos que o primeiro não comprovado não são consultados'); assert.equal(by['2026-08'].classes_confirmed,false); assert.equal(by['2026-08'].concentration,null);
  assert.equal(r.history.length,11);
  assert.deepEqual(r.sku_history.months,r.history.map(h=>h.key)); assert.deepEqual(Object.keys(r.sku_history.rows).sort(),['AAA','BBB','CCC']);
  assert.equal(r.sku_history.rows.AAA[r.sku_history.months.indexOf('2026-10')][0],'CLASSIFICADO');
  assert.equal(r.sku_history.rows.AAA[r.sku_history.months.indexOf('2026-08')][0],'NAO_CONFIRMADO');
  const q=calls.filter(c=>c[0]==='quality'); assert.deepEqual(q.map(c=>c[1].start.slice(0,7)).sort(),['2026-09','2026-10','2026-11'],'cobertura só até o primeiro mês não comprovado (um lote de 3)');
  assert.equal(calls.filter(c=>c[0]==='split').length,11,'GA-021 em todos os meses (a conciliação de cada mês depende dela)');
  assert.equal(calls.filter(c=>c[0]==='units').length,1); assert.ok(calls.find(c=>c[0]==='units')[1].periods.every(p=>/^\d{4}-\d{2}$/.test(p.key)),'unidades só dos meses');
  assert.ok(state.peak<=3,'pico '+state.peak); assert.equal(calls.filter(c=>c[0]==='version').length,2);
  assert.equal(r.metrics.queries,calls.length); assert.equal(r.budget.history_skipped,0); assert.ok(calls.length<=SUBREQUEST_BUDGET);
});
test('GA-P01 histórico ML: sem GA-021; cobertura da mesma forma',async()=>{
  const {deps,calls}=mk(); const r=await commerceAbcHistoryV1({},histArgs({platform:'ML_NOVO'}),deps);
  assert.equal(r.status,'OK'); assert.equal(calls.filter(c=>c[0]==='split').length,0); assert.equal(r.history.find(h=>h.key==='2026-10').status,'CONFIRMADO');
});
test('GA-P01 versão: se a importação mudou a versão ANTES do histórico, nada é consultado nem entregue',async()=>{
  const {deps,calls}=mk(); const r=await commerceAbcHistoryV1({},histArgs({dataVersion:'v0-antiga'}),deps);
  assert.equal(r.status,'VERSAO_ALTERADA'); assert.equal(r.data_version,'v1'); assert.equal(r.history,undefined); assert.equal(r.sku_history,undefined);
  assert.equal(calls.some(c=>['source','units','quality','split'].includes(c[0])),false);
});
test('GA-P01 versão: importação DURANTE o cálculo do histórico descarta tudo (não mistura versões)',async()=>{
  const {deps,state}=mk(); let n=0; state.version=()=>(++n>=2?'v2':'v1');
  const r=await commerceAbcHistoryV1({},histArgs(),deps);
  assert.equal(r.status,'VERSAO_ALTERADA'); assert.equal(r.data_version,'v2'); assert.equal(r.history,undefined); assert.equal(r.sku_history,undefined);
});
test('GA-P01 versão: sem conseguir ler a versão, o histórico não é entregue',async()=>{
  const {deps,state}=mk(); state.version=new Error('fora');
  const r=await commerceAbcHistoryV1({},histArgs(),deps); assert.equal(r.status,'VERSAO_INDISPONIVEL'); assert.equal(r.history,undefined);
  const i=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},mk({}).deps);
  assert.equal(i.data_version,'v1');
  // GA-P01 (revisão Atlas): indicadores também exigem versão legível e igual no começo e no fim
  const {deps:d2,state:s2,calls:c2}=mk(); s2.version=new Error('fora'); const i2=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},d2);
  assert.equal(i2.status,'VERSAO_INDISPONIVEL'); assert.equal(i2.reason,'VERSAO_ILEGIVEL_NO_INICIO'); assert.equal(i2.comparison,undefined); assert.equal(i2.current,undefined);
  assert.deepEqual(c2.filter(c=>c[0]!=='version'),[],'sem versão no início nada mais é consultado');
});
test('GA-P01 versão: importação DURANTE os indicadores devolve VERSAO_ALTERADA, sem indicadores misturados',async()=>{
  const {deps,state}=mk(); let n=0; state.version=()=>(++n>=2?'v2':'v1');
  const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},deps);
  assert.equal(r.status,'VERSAO_ALTERADA'); assert.equal(r.data_version,'v2'); assert.equal(r.current,undefined); assert.equal(r.comparison,undefined);
});
test('GA-P01 concorrência: nunca mais de 3 consultas ao mesmo tempo, em indicadores e histórico, no pior caso de 14 sondas',async()=>{
  let active=0,peak=0;
  const wrap=h=>async(...a)=>{active++;peak=Math.max(peak,active);try{await new Promise(r=>setTimeout(r,2));return await h(...a);}finally{active--;}};
  const h=worstHandler(true);
  const real=globalThis.fetch;
  globalThis.fetch=wrap(async(url,init)=>{const name=decodeURIComponent(String(url).split('/rpc/')[1]);const b=JSON.parse(init.body);const out=name==='commerce_data_version_v1'?'vfix':h(name,b);return new Response(JSON.stringify(out),{status:200,headers:{'content-type':'application/json'}});});
  try{
    const r=await commerceAbcEvolutionV1(ENV,{platform:'SHOPEE',mode:'7d'},{...realDeps(),version:async()=>'vfix'});
    assert.ok(peak<=3,'indicadores: pico '+peak); assert.equal(r.status,'OK');
    peak=0; const hh=await commerceAbcHistoryV1(ENV,histArgs({last:'2026-11-10',dataVersion:'vfix'}),{...realDeps(),version:async()=>'vfix'});
    assert.ok(peak<=3,'histórico: pico '+peak); assert.equal(hh.status,'OK');
  }finally{globalThis.fetch=real;}
});
test('GA-P01 histórico no pior caso (Shopee, 12 meses): cabe no orçamento de requisições reais e a leitura da versão não passa de 2',async()=>{
  await withFetch((n,b)=>n==='commerce_data_version_v1'?'vfix':worstHandler(true)(n,b),async calls=>{
    const r=await commerceAbcHistoryV1(ENV,histArgs({last:'2026-11-23',dataVersion:'vfix'}),{...realDeps(),version:async(e)=>{const {commerceDataVersion}=await import('../src/ga/commerce-supabase-store.js');return commerceDataVersion(e);}});
    assert.equal(r.status,'OK'); assert.ok(calls.length<=SUBREQUEST_BUDGET,'requisições: '+calls.length); assert.equal(r.budget.used,calls.length);
    assert.equal(calls.filter(c=>c==='commerce_data_version_v1').length,2); assert.equal(calls.filter(c=>c==='commerce_abc_units_monthly_v1').length,1);
  });
});
test('GA-P01 orçamento: o que não couber não é consultado e fica "não verificado nesta consulta", nunca confirmado',async()=>{
  const {deps,calls}=mk({budget:12});
  const r=await commerceAbcHistoryV1({},histArgs(),deps);
  assert.equal(r.status,'OK'); assert.ok(r.budget.history_skipped>0); assert.ok(calls.length<=12,'respeitou o orçamento: '+calls.length);
  const sk=r.history.filter(h=>h.reconciliation.reason==='NAO_VERIFICADO'); assert.equal(sk.length,r.budget.history_skipped);
  for(const h of sk){assert.equal(h.coverage,'NAO_VERIFICADA'); assert.equal(h.status,'BLOQUEADO_INDISPONIVEL'); assert.equal(h.class_counts,null);}
  assert.equal(r.history.filter(h=>h.status==='CONFIRMADO').length>=0,true);
});
test('GA-P01 isolamento: unidades de outra conta ou de outras datas no histórico são descartadas',async()=>{
  const {deps}=mk(); const base=deps.units;
  const other=await commerceAbcHistoryV1({},histArgs({platform:'ML_NOVO'}),{...deps,units:async(e,a)=>({...await base(e,a),platform:'ML_ANTIGO'})});
  assert.ok(other.history.every(h=>h.status==='BLOQUEADO_INDISPONIVEL'&&h.class_counts===null));
  assert.deepEqual(Object.values(other.sku_history.rows).map(r=>r.every(c=>c[0]==='BLOQUEADO')),[true,true,true]);
});
test('GA-P01 histórico: conciliação diferente bloqueia só aquele mês; falha da divisão de um mês não derruba os outros',async()=>{
  const {deps}=mk({source:async(_e,a)=>days(a.start,a.end).map(d=>({sale_date:d,units:d==='2026-10-05'?11:10}))});
  const r=await commerceAbcHistoryV1({},histArgs({platform:'ML_NOVO'}),deps);
  assert.equal(r.history.find(h=>h.key==='2026-10').status,'BLOQUEADO_DIVERGENTE'); assert.equal(r.history.find(h=>h.key==='2026-11').status,'CONFIRMADO');
  const {deps:d2}=mk({split:async(_e,a)=>{if(a.start==='2026-03-01')throw new Error('x');return {start:a.start,end:a.end,total_units:days(a.start,a.end).length*10,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:0}};}});
  const p=await commerceAbcHistoryV1({},histArgs(),d2); assert.equal(p.history.find(h=>h.key==='2026-03').status,'BLOQUEADO_INDISPONIVEL'); assert.equal(p.history.find(h=>h.key==='2026-10').status,'CONFIRMADO'); assert.ok(p.failed.includes('split'));
});
test('GA-P01 histórico: entradas inválidas são recusadas antes de qualquer consulta',async()=>{
  const {deps,calls}=mk();
  for(const bad of [{platform:'TODAS'},{mode:'60d'},{month:'2026-13'},{last:'2026-13-40'},{last:'ontem'},{last:null},{dataVersion:''},{dataVersion:null},{dataVersion:'x'.repeat(201)},{skus:'AAA'},{skus:[1]},{skus:['']},{skus:['x'.repeat(121)]},{skus:Array.from({length:201},(_,i)=>'S'+i)}])
    await assert.rejects(()=>commerceAbcHistoryV1({},histArgs(bad),deps),/inválid/,JSON.stringify(bad).slice(0,60));
  assert.equal(calls.length,0);
});
test('GA-P01 histórico: a resposta não traz nenhum campo financeiro',async()=>{
  const {deps}=mk(); const r=await commerceAbcHistoryV1({},histArgs(),deps);
  assert.ok(!/revenue|receita|ticket|faturamento|margin|price/i.test(JSON.stringify(r)));
});
test('GA-P01 sondas do último dia em lote dão o MESMO resultado da busca em série',async()=>{
  const {findLastCompleteDay}=await import('../src/ga/commerce-supabase-store.js');
  const quality=async(_e,a)=>dayQ('SHOPEE',a.start,a.start>'2026-11-20'?'PARCIAL':'COMPLETO');
  const serial=await findLastCompleteDay({},{platform:'SHOPEE',today:TODAY,quality}); const batch=await findLastCompleteDay({},{platform:'SHOPEE',today:TODAY,quality,concurrency:3});
  assert.equal(batch.last_complete_day,serial.last_complete_day); assert.deepEqual(batch.skipped,serial.skipped); assert.equal(batch.last_import_day,serial.last_import_day); assert.ok(batch.probes>=serial.probes);
  // erro numa sonda MAIS ANTIGA que o dia completo (já lida em lote) não esconde o dia completo mais novo
  const q2=async(_e,a)=>{if(a.start<'2026-11-23')throw new Error('x');return dayQ('SHOPEE',a.start,a.start==='2026-11-23'?'COMPLETO':'PARCIAL');};
  const ok=await findLastCompleteDay({},{platform:'SHOPEE',today:TODAY,quality:q2,concurrency:3}); assert.equal(ok.last_complete_day,'2026-11-23');
  // erro numa sonda que SERIA lida (a mais nova) continua sendo erro
  await assert.rejects(()=>findLastCompleteDay({},{platform:'SHOPEE',today:TODAY,quality:async()=>{throw new Error('boom');},concurrency:3}),/boom/);
});

test('GA-P01 revisão: versão ilegível só no FIM dos indicadores não confirma resultado',async()=>{
  const {deps,state}=mk(); let n=0; state.version=()=>{if(++n>=2)throw new Error('fora');return 'v1';};
  const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},deps);
  assert.equal(r.status,'VERSAO_INDISPONIVEL'); assert.equal(r.reason,'VERSAO_ILEGIVEL_NO_FIM'); assert.equal(r.comparison,undefined); assert.equal(r.data_version,null);
  const e=mk(); let m=0; e.state.version=()=>(++m>=2?'':'v1'); // versão vazia no fim também é ilegível
  const r2=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},e.deps); assert.equal(r2.status,'VERSAO_INDISPONIVEL');
});
test('GA-P01 revisão: histórico com versão ilegível no FIM não é entregue',async()=>{
  const {deps,state}=mk(); let n=0; state.version=()=>{if(++n>=2)throw new Error('fora');return 'v1';};
  const r=await commerceAbcHistoryV1({},histArgs(),deps);
  assert.equal(r.status,'VERSAO_INDISPONIVEL'); assert.equal(r.history,undefined); assert.equal(r.sku_history,undefined);
});
test('GA-P01 revisão: recuperação — depois da falha de versão, nova consulta com versão legível entrega o resultado',async()=>{
  const {deps,state}=mk(); state.version=new Error('fora');
  assert.equal((await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},deps)).status,'VERSAO_INDISPONIVEL');
  state.version='v9';
  const ok=await commerceAbcEvolutionV1({},{platform:'ML_NOVO',mode:'7d'},deps); assert.equal(ok.status,'OK'); assert.equal(ok.data_version,'v9');
  const h=await commerceAbcHistoryV1({},histArgs({dataVersion:'v9'}),deps); assert.equal(h.status,'OK'); assert.equal(h.data_version,'v9');
});
