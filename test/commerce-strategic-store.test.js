// GA-013 — Visão estratégica: montagem no servidor (store) e rota. Dados fictícios, dependências injetadas, sem rede.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {commerceStrategicViewV1} from '../src/ga/commerce-supabase-store.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const router=read('src/ga/commerce-admin-router.js'),store=read('src/ga/commerce-supabase-store.js');

const dash=p=>({platform:p,days:7,first_day:'2025-01-01',last_day:'2026-11-23',current_start:'2026-11-17',previous_start:'2026-11-10',
  totals:{cur_units:14,prev_units:10},drops:{items:[]}});
const dq=(platform,start,end,days,complete=true)=>({platform,period:{start,end},sales:{status:complete?'COMPLETA':'PARCIAL',requested_days:days,
  complete_days:complete?days:days-1,partial_days:0,days_without_information:complete?0:1,days_with_records_unverified:0,missing_ranges:complete?[]:[{start,end:start,days:1}]}});
const mk=(over={})=>{
  const calls=[];
  const deps={
    dashboard:async (_e,a)=>{calls.push(['dashboard',a]);return dash(a.platform);},
    overview:async (_e,a)=>{calls.push(['overview',a]);return {listings:{active:1},top_units:[],growth:[],stopped:[],no_sales:[]};},
    monthly:async (_e,a)=>{calls.push(['monthly',a]);return {months:[]};},
    series:async (_e,a)=>{calls.push(['series',a]);return {daily:[]};},
    categories:async (_e,a)=>{calls.push(['categories',a]);return {total:{cur:1,base:1},categories:[]};},
    shopeePerf:async()=>({reports:[],items:{}}),mlPerf:async()=>({reports:[],items:{}}),
    quality:async(_e,a)=>{calls.push(['quality',a]);return dq(a.platform,a.start,a.end,Math.round((Date.parse(a.end)-Date.parse(a.start))/86400000)+1);},
    split:async(_e,a)=>{calls.push(['split',a]);return {status:'COMPLETO',total_units:14,linked_units:14,unlinked_units:0,base_units:14,
      difference:{units:0,unlinked_effect_units:0,other_explained_units:0,residual_units:0,explained:true},
      reconciliation:{status:'EXPLICADA',source_units_match:true,identity_ok:true},coverage:{missing_days:0,days_with_data:7,missing_ranges:[]}};},
    ...over};
  return {deps,calls};
};

test('store: monta a visão pedindo cada parte para a MESMA conta e para os períodos do Dashboard',async()=>{
  const {deps,calls}=mk();
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(v.platform,'SHOPEE'); assert.equal(v.units.current,14);
  for(const [name,a] of calls.filter(c=>['dashboard','overview','monthly','series','categories','quality'].includes(c[0])))
    assert.equal(a.platform,'SHOPEE',name+' pediu outra conta');
  const q=calls.filter(c=>c[0]==='quality').map(c=>[c[1].start,c[1].end]);
  assert.deepEqual(q,[['2026-11-17','2026-11-23'],['2026-11-10','2026-11-16'],['2025-01-01','2026-11-23']]);
  assert.deepEqual(calls.find(c=>c[0]==='split')[1],{start:'2026-11-17',end:'2026-11-23'});
  assert.deepEqual(calls.find(c=>c[0]==='categories')[1],{platform:'SHOPEE',mode:'days',days:7});
  assert.equal(v.units.verified.current,true); assert.equal(v.units.verified.previous,true);
});

test('store: ML não pede a divisão total x vinculada e nunca recebe cobertura de outra conta',async()=>{
  const {deps,calls}=mk({quality:async(_e,a)=>dq('SHOPEE',a.start,a.end,7)});
  const v=await commerceStrategicViewV1({},{platform:'ML_NOVO',days:7},deps);
  assert.equal(calls.some(c=>c[0]==='split'),false);
  assert.equal(v.units.verified.current,false,'cobertura da Shopee não comprova o ML Novo');
});

test('store: parte que falha vira indisponível e o resto continua',async()=>{
  const {deps}=mk({categories:async()=>{throw new Error('segredo-interno');},split:async()=>{throw new Error('x');}});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(v.parts.categories,'INDISPONIVEL'); assert.equal(v.parts.split,'INDISPONIVEL'); assert.equal(v.parts.overview,'OK');
  assert.equal(v.units.current,14);
  assert.doesNotMatch(JSON.stringify(v),/segredo-interno/);
});

test('store: histórico maior que 1100 dias não é afirmado como comprovado',async()=>{
  const {deps,calls}=mk({dashboard:async (_e,a)=>({...dash(a.platform),first_day:'2020-01-01'})});
  const v=await commerceStrategicViewV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(calls.filter(c=>c[0]==='quality').length,2);
  assert.equal(v.coverage.history.proven,false);
});

test('store: recusa conta fora das três e janela inválida',async()=>{
  const {deps}=mk();
  await assert.rejects(()=>commerceStrategicViewV1({},{platform:'TODAS',days:7},deps));
  await assert.rejects(()=>commerceStrategicViewV1({},{platform:'SHOPEE',days:15},deps));
});

test('rota: só as três contas, janelas 7/30/60/90, fora do cache de borda e sem escrita',()=>{
  const i=router.indexOf("BASE_PATH+'/strategic-view'");
  assert.ok(i>0,'rota existe');
  const block=router.slice(i-40,i+700);
  assert.ok(block.includes("['SHOPEE','ML_ANTIGO','ML_NOVO'].includes(platform)")&&!/'TODAS'/.test(block));
  assert.ok(block.includes('[7,30,60,90].includes(days)'));
  assert.ok(block.includes('commerceStrategicViewV1'));
  assert.ok(!router.slice(i,i+700).includes('sales-dashboard/strategic'),'não pode ficar sob o prefixo cacheado');
  const fn=store.slice(store.indexOf('export async function commerceStrategicViewV1'));
  assert.doesNotMatch(fn,/method:\s*'(POST|PUT|DELETE|PATCH)'/);
  assert.doesNotMatch(fn,/cachedRpc\(env,'commerce_data_quality_v1'/);
});
