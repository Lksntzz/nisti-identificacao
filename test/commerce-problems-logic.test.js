import test from 'node:test';
import assert from 'node:assert/strict';
import {GROUPS,PROBLEM_PCT,PLATFORM_LABEL,headline,campaignWarning} from '../src/ga/commerce-problems-logic.js';

const top3=[{title:'A',lost_revenue:4100,share_pct:40,active:true},{title:'B',lost_revenue:2000,share_pct:20,active:true},{title:'C',lost_revenue:1100,share_pct:11,active:true}];

test('constantes: 4 grupos na ordem de prioridade e limite de -15%',()=>{
  assert.deepEqual(GROUPS,[['PAROU','Parou'],['QUEDA','Em queda'],['PIOR','Pior performance'],['NUNCA','Nunca vendeu']]);
  assert.equal(PROBLEM_PCT,-15);
  assert.equal(PLATFORM_LABEL.ML_NOVO,'ML Novo');
});
test('headline: queda forte cita % e quantos anúncios explicam',()=>{
  const t=headline({platform:'ML_NOVO',var_pct:-38,base_ok:true,lost_revenue:12400,inactive_share_pct:0,top:top3});
  assert.match(t,/ML Novo caiu 38%/);
  assert.match(t,/3 anúncios explicam 71%/);
  assert.match(t,/R\$\s?12\.400/);
});
test('headline: variação pequena é "sem queda"',()=>{
  assert.match(headline({platform:'ML_ANTIGO',var_pct:-3,base_ok:true,lost_revenue:100,inactive_share_pct:0,top:[]}),/ML Antigo.*sem queda/);
});
test('headline: sem régua nunca vira queda',()=>{
  const t=headline({platform:'SHOPEE',var_pct:null,base_ok:false,lost_revenue:0,inactive_share_pct:0,top:[]});
  assert.match(t,/Shopee.*sem base de comparação/);assert.doesNotMatch(t,/caiu|-100/);
});
test('headline: avisa quando parte da queda vem de anúncios inativos',()=>{
  const t=headline({platform:'SHOPEE',var_pct:-20,base_ok:true,lost_revenue:5000,inactive_share_pct:30,top:top3});
  assert.match(t,/30%.*não estão mais ativos/);
});
test('campaignWarning: 11.11, Black Friday e período limpo',()=>{
  assert.match(campaignWarning('2026-11-09','2026-11-22'),/11\.11/);
  assert.match(campaignWarning('2026-11-23','2026-11-29'),/Black Friday/);
  assert.equal(campaignWarning('2026-09-01','2026-09-30'),null);
  assert.match(campaignWarning('2026-10-05','2026-10-12'),/10\.10/);
});
