// GA-014 — montagem no servidor com dependências injetadas e formatos reais das respostas do banco (sem rede).
import test from 'node:test';
import assert from 'node:assert/strict';
import {commerceDecisionCenterV1} from '../src/ga/commerce-supabase-store.js';

const dash=p=>({platform:p,days:7,first_day:'2025-01-01',last_day:'2026-11-24',current_start:'2026-11-18',previous_start:'2026-11-11',totals:{cur_units:30,prev_units:20}});
const dq=(platform,start,end)=>({platform,period:{start,end},sales:{status:'COMPLETA',requested_days:7,complete_days:7,partial_days:0,days_without_information:0,days_with_records_unverified:0,missing_ranges:[]}});
const row=(ext,uc,up,o={})=>({ext,listing_id:'id-'+ext,title:'Anúncio '+ext,registered:true,ambiguous_status:false,status:'ACTIVE',status_checked_at:'2026-11-17T10:00:00+00:00',units_current:uc,units_previous:up,last_sale:'2026-11-24',first_sale:'2026-01-02',perf:{latest:null,previous:null},...o});
const units=(platform,rows)=>({platform,current:{start:'2026-11-18',end:'2026-11-24'},previous:{start:'2026-11-11',end:'2026-11-17'},
  totals:{listings:rows.length,listings_with_sales:rows.length,units_current:rows.reduce((a,r)=>a+r.units_current,0),units_previous:rows.reduce((a,r)=>a+r.units_previous,0),listings_unregistered:0,units_current_unregistered:0,units_previous_unregistered:0,listings_ambiguous_status:0},
  row_count:rows.length,truncated:false,reports:{latest:null,previous:null},rows});
const mk=(over={})=>{
  const calls=[];
  const deps={
    dashboard:async(_e,a)=>{calls.push(['dashboard',a]);return dash(a.platform);},
    units:async(_e,a)=>{calls.push(['units',a]);return units(a.platform,[row('A',10,20),row('B',20,0)]);},
    quality:async(_e,a)=>{calls.push(['quality',a]);return dq(a.platform,a.start,a.end);},
    split:async(_e,a)=>{calls.push(['split',a]);return {status:'COMPLETO',total_units:30,linked_units:30,unlinked_units:0,base_units:30,difference:{units:0,unlinked_effect_units:0,other_explained_units:0,residual_units:0,explained:true},reconciliation:{status:'EXPLICADA',source_units_match:true,identity_ok:true},coverage:{missing_days:0,days_with_data:7,missing_ranges:[]}};},
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
  for(const bad of [p=>({...units(p,[row('A',1,1)]),truncated:true}),()=>units('ML_ANTIGO',[row('A',1,1)])]){
    const {deps}=mk({units:async(_e,a)=>bad(a.platform)});
    const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
    assert.equal(r.status,'INDISPONIVEL');
  }
});
test('store: soma por anúncio divergente do Dashboard aparece como divergência, sem esconder',async()=>{
  const {deps}=mk({units:async(_e,a)=>units(a.platform,[row('A',10,5)])});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.equal(r.reconciliation.dashboard.status,'DIVERGENTE');
  assert.ok(r.notices.some(n=>n.kind==='UNIDADES_DIVERGENTES'));
});
test('store: sem campo financeiro na resposta',async()=>{
  const {deps}=mk({units:async(_e,a)=>units(a.platform,[{...row('A',10,20),revenue:999,gmv:1}])});
  const r=await commerceDecisionCenterV1({},{platform:'SHOPEE',days:7},deps);
  assert.doesNotMatch(JSON.stringify(r),/revenue|gmv|faturamento|lucro/i);
});
