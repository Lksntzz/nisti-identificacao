// GA-014 — montagem no servidor com dependências injetadas e formatos reais das respostas do banco (sem rede).
import test from 'node:test';
import assert from 'node:assert/strict';
import {commerceDecisionCenterV1} from '../src/ga/commerce-supabase-store.js';

import {dash as dashFx,dq,row,units,splitOf} from './fixtures-decision.js';
const dash=p=>dashFx({platform:p,days:7,last_day:'2026-11-24',current_start:'2026-11-18',previous_start:'2026-11-11',totals:{cur_units:30,prev_units:20}});
const mkUnits=(platform,rows)=>({...units(rows),platform,current:{start:'2026-11-18',end:'2026-11-24'},previous:{start:'2026-11-11',end:'2026-11-17'}});
const mk=(over={})=>{
  const calls=[];
  const deps={
    dashboard:async(_e,a)=>{calls.push(['dashboard',a]);return dash(a.platform);},
    units:async(_e,a)=>{calls.push(['units',a]);return mkUnits(a.platform,[row('A',10,20),row('B',20,0)]);},
    quality:async(_e,a)=>{calls.push(['quality',a]);return dq(a.platform,a.start,a.end);},
    split:async(_e,a)=>{calls.push(['split',a]);const t=a.start==='2026-11-18'?30:20;return splitOf(a.start,a.end,{total:t,linked:t});},
    ...over};
  return {deps,calls};
};

test('store: pede tudo para a MESMA conta e para os períodos do Dashboard',async()=>{
  const {deps,calls}=mk();
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.platform,'SHOPEE'); assert.equal(r.read_only,true);
  assert.deepEqual(calls.find(c=>c[0]==='units')[1],{platform:'SHOPEE',current:{start:'2026-11-18',end:'2026-11-24'},previous:{start:'2026-11-11',end:'2026-11-17'}});
  for(const [n,a] of calls.filter(c=>['dashboard','units','quality'].includes(c[0])))assert.equal(a.platform,'SHOPEE',n);
  assert.deepEqual(calls.filter(c=>c[0]==='quality').map(c=>[c[1].start,c[1].end]).sort(),[['2026-11-11','2026-11-17'],['2026-11-18','2026-11-24']]);
});
test('store: ML não pede a divisão por vínculo (só Shopee)',async()=>{
  const {deps,calls}=mk();
  await commerceDecisionCenterV1({},{platform:'ML_NOVO',days:7},deps);
  assert.equal(calls.some(c=>c[0]==='split'),false);
});
test('store: filtros inválidos são recusados antes de qualquer consulta',async()=>{
  const {deps,calls}=mk();
  for(const f of [{platform:'TODAS',days:7},{platform:'SHOPEE',days:60},{platform:'x',days:7},{platform:'SHOPEE',days:'7; drop'}])
    await assert.rejects(()=>commerceDecisionCenterV1({},f,deps));
  assert.equal(calls.length,0);
});
test('store: função de unidades indisponível vira INDISPONIVEL, sem vazar o erro',async()=>{
  const {deps}=mk({units:async()=>{throw new Error('segredo-interno');}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.status,'INDISPONIVEL');
  assert.doesNotMatch(JSON.stringify(r),/segredo-interno/);
});
test('store: resposta truncada ou de outra conta falha fechado',async()=>{
  for(const bad of [p=>({...mkUnits(p,[row('A',1,1)]),truncated:true}),()=>mkUnits('ML_ANTIGO',[row('A',1,1)])]){
    const {deps}=mk({units:async(_e,a)=>bad(a.platform)});
    const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
    assert.equal(r.status,'INDISPONIVEL');
  }
});
test('store: soma por anúncio divergente do Dashboard aparece como divergência, sem esconder',async()=>{
  const {deps}=mk({units:async(_e,a)=>mkUnits(a.platform,[row('A',10,5)])});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.reconciliation.dashboard.status,'DIVERGENTE');
  assert.ok(r.notices.some(n=>n.kind==='UNIDADES_DIVERGENTES'));
});
test('store: sem campo financeiro na resposta',async()=>{
  const {deps}=mk({units:async(_e,a)=>mkUnits(a.platform,[{...row('A',10,20),revenue:999,gmv:1}])});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.doesNotMatch(JSON.stringify(r),/revenue|gmv|faturamento|lucro/i);
});

test('store (item 7): Dashboard com períodos inválidos não dispara nenhuma outra consulta',async()=>{
  for(const bad of [{days:30},{platform:'ML_NOVO'},{current_start:'2026-11-17'},{previous_start:'2026-11-12'},{last_day:'x'}]){
    const {deps,calls}=mk({dashboard:async(_e,a)=>({...dash(a.platform),...bad})});
    const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
    assert.equal(r.status,'INDISPONIVEL'); assert.equal(r.parts.dashboard,'RESPOSTA_INVALIDA'); assert.deepEqual(calls,[],'nada além do Dashboard foi consultado: '+JSON.stringify(bad));
  }
});
test('store (item 5): a divisão por SKU da Shopee é pedida para os DOIS períodos',async()=>{
  const {deps,calls}=mk();
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.deepEqual(calls.filter(c=>c[0]==='split').map(c=>[c[1].start,c[1].end]).sort(),[['2026-11-11','2026-11-17'],['2026-11-18','2026-11-24']]);
  assert.equal(r.reconciliation.shopee.current.status,'EXPLICADA'); assert.equal(r.reconciliation.shopee.previous.status,'EXPLICADA'); assert.equal(r.blocked_confirmations,false);
});
test('store (item 5): divergência do período anterior na divisão da Shopee bloqueia as classificações confirmadas',async()=>{
  const {deps}=mk({split:async(_e,a)=>{const cur=a.start==='2026-11-18';return splitOf(a.start,a.end,{total:cur?30:20,linked:cur?30:20,base:cur?30:99});}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.blocked_confirmations,true); assert.equal(r.tiers.alta.total+r.tiers.revisao.total+r.tiers.oportunidade.total+r.tiers.sem_prioridade.total,0);
});
test('store: divisão por SKU que falha não é divergência (conciliação indisponível, sem bloquear)',async()=>{
  const {deps}=mk({split:async()=>{throw new Error('x');}});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.parts.split,'INDISPONIVEL'); assert.equal(r.blocked_confirmations,false);
});
