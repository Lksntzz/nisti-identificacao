// GA-015 — camada de leitura da Evolução ABC com dependências simuladas (dados FICTÍCIOS, nenhum banco).
import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceAbcEvolutionV1 } from '../src/ga/commerce-abc-store.js';

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
  const calls=[];
  const deps={
    today:()=>TODAY,
    quality:async(_e,a)=>{calls.push(['quality',a]);
      if(a.start===a.end)return dayQ(a.platform,a.start,a.start==='2026-11-24'?'PARCIAL':'COMPLETO');
      return rangeQ(a.platform,a.start,a.end,a.start>=PROVEN_FROM&&a.end<='2026-11-23');},
    source:async(_e,a)=>{calls.push(['source',a]);return days(a.start,a.end).map(d=>({sale_date:d,units:10+NOSKU-NOSKU}));}, // 6+3+1=10 com SKU; sem SKU é +2 abaixo
    units:async(_e,a)=>{calls.push(['units',a]);return {platform:a.platform,periods:a.periods.map(p=>{const n=days(p.start,p.end).length;return {key:p.key,start:p.start,end:p.end,days:span(p.start,p.end),days_with_data:n,total_units:n*10,sku_units:n*10,no_sku_units:0,ranked_units:n*10,nonpositive_units:0,products:n?3:0};}),
      product_count:3,products:Object.entries(SKUS).map(([sku,u])=>({sku,units:Object.fromEntries(a.periods.map(p=>[p.key,days(p.start,p.end).length*u]))}))};},
    split:async(_e,a)=>{calls.push(['split',a]);const n=days(a.start,a.end).length*10;return {start:a.start,end:a.end,total_units:n,unlinked_units:0,reconciliation:{status:'EXPLICADA',identity_ok:true,source_units_match:true},difference:{residual_units:0}};},
    ...over};
  return {deps,calls};
};

test('Shopee 7 dias: janela termina em 23/11 (24/11 é parcial), tudo confirmado e histórico cobre só a partir de outubro',async()=>{
  const {deps,calls}=mk();
  const r=await commerceAbcEvolutionV1({},{platform:'SHOPEE',mode:'7d'},deps);
  assert.equal(r.status,'OK'); assert.equal(r.last_complete_day,'2026-11-23'); assert.equal(r.window.probes,2); assert.deepEqual(r.window.skipped,[{day:'2026-11-24',state:'PARCIAL'}]);
  assert.deepEqual([r.current.start,r.current.end,r.previous.start,r.previous.end],['2026-11-17','2026-11-23','2026-11-10','2026-11-16']);
  assert.equal(r.comparison.state,'CONFIRMADA'); assert.equal(r.current.status,'CONFIRMADO');
  const by=Object.fromEntries(r.history.map(h=>[h.key,h])); assert.equal(by['2026-10'].status,'CONFIRMADO'); assert.equal(by['2026-11'].incomplete,true);
  assert.equal(by['2026-09'].status,'NAO_COMPROVADO'); assert.equal(by['2026-09'].coverage,'NAO_COMPROVADA'); assert.equal(by['2026-08'].coverage,'NAO_VERIFICADA','mais antigos que o primeiro não comprovado não são consultados');
  assert.equal(by['2026-08'].classes_confirmed,false); assert.equal(by['2026-08'].concentration,null);
  assert.equal(calls.filter(c=>c[0]==='units').length,1); assert.equal(calls.filter(c=>c[0]==='source').length,1); assert.ok(calls.filter(c=>c[0]==='split').length>=13);
  assert.ok(calls.length<=40,'cabe nos limites de requisição: '+calls.length);
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
  assert.equal(r.comparison.state,'CONFIRMADA');
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
  void n; assert.equal(partial.history.find(h=>h.key==='2026-03').status,'BLOQUEADO_INDISPONIVEL'); assert.equal(partial.comparison.state,'CONFIRMADA');
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
