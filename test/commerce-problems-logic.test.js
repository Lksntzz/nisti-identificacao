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

import {windowWarning} from '../src/ga/commerce-problems-logic.js';
test('windowWarning: avisa também quando a RÉGUA (meses anteriores) contém campanha',()=>{
  const w={start:'2026-12-06',end:'2027-01-04',base_start:'2026-09-01',base_end:'2026-11-30'};
  assert.match(windowWarning(w),/régua|meses usados como base/i);
  assert.match(windowWarning(w),/11\.11/);
  assert.equal(windowWarning({start:'2026-03-01',end:'2026-03-30',base_start:'2025-12-01',base_end:'2026-02-28'}),null);
  assert.match(windowWarning({start:'2026-11-01',end:'2026-11-22',base_start:'2026-07-01',base_end:'2026-09-30'}),/Este período contém 11\.11/);
});

import {listingsNote} from '../src/ga/commerce-problems-logic.js';
test('listingsNote: plataforma pode crescer no total e ainda ter anúncios parados — a frase mostra os dois',()=>{
  assert.equal(listingsNote({PAROU:79,QUEDA:27}),'79 anúncios pararam de vender e 27 anúncios caíram');
  assert.equal(listingsNote({PAROU:1,QUEDA:0}),'1 anúncio parou de vender');
  assert.equal(listingsNote({PAROU:0,QUEDA:3}),'3 anúncios caíram');
  assert.equal(listingsNote({PAROU:0,QUEDA:1}),'1 anúncio caiu');
  assert.equal(listingsNote({PAROU:0,QUEDA:0}),'');
  assert.equal(listingsNote(null),'');
});
