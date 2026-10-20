import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildListingDiagnosis } from '../src/commerce-listing-diagnostics.js';

const base = {
  source:'SHOPEE',title:'Capa de agenda 2027',ready:true,units:8,
  variation_data_complete:true,zero_variations:0,
  identified_growth_pct:null,identified_trend:'INSUFFICIENT'
};

test('diagnóstico não converte falta de vínculo em zero', () => {
  const result=buildListingDiagnosis({...base,ready:false,units:0,identified_units:null},30);
  assert.equal(result.summary.tone,'warning');
  assert.ok(result.signals.some(s=>s.id==='coverage'));
  assert.ok(!result.signals.some(s=>s.id==='no-sales'));
  assert.ok(!result.signals.some(s=>s.id==='variations'));
});

test('queda prova tendência vinculada, não problema no preço ou título', () => {
  const result=buildListingDiagnosis({...base,identified_trend:'FALLING',identified_growth_pct:-62.5},30);
  assert.equal(result.summary.tone,'danger');
  assert.match(result.summary.title,/causa não confirmada/i);
  assert.ok(result.signals.find(s=>s.id==='fall').evidence.includes('-62,5%'));
  assert.ok(result.checks.every(c=>c.status!=='Causa comprovada'));
  assert.ok(result.missing.includes('Visitas'));
});

test('zero confiável e variações zeradas geram alertas específicos', () => {
  const result=buildListingDiagnosis({...base,units:0,zero_variations:2},7);
  assert.ok(result.signals.find(s=>s.id==='no-sales'));
  assert.ok(result.signals.find(s=>s.id==='variations'));
  assert.match(result.summary.title,/sem vendas atribuídas/i);
});

test('mês personalizado não herda tendência de 30 dias', () => {
  const result=buildListingDiagnosis({...base,identified_trend:'FALLING',identified_growth_pct:-60},0);
  assert.equal(result.available.trend,false);
  assert.ok(!result.signals.find(s=>s.id==='fall'));
});

test('título curto só produz oportunidade editorial, sem causalidade', () => {
  const result=buildListingDiagnosis({...base,title:'Capa A5'},30);
  assert.ok(result.signals.some(s=>s.id==='title'));
  assert.match(result.signals.find(s=>s.id==='title').evidence,/não prova/i);
});

test('integração abre diagnóstico do anúncio e compacta cartões evolutivos',()=>{
  const app=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
  const evolution=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
  const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');
  assert.match(app,/\['diagnosis','Diagnóstico'\]/);
  assert.match(app,/ListingDiagnosisPanel item=\{detail\} days=\{detailDays\}/);
  assert.match(app,/useState\('diagnosis'\)/);
  assert.match(evolution,/<details className="nim-evolution-product"/);
  assert.match(evolution,/<summary className="nim-evolution-product-head"/);
  assert.match(css,/\.nim-evolution-quick-stats/);
  assert.doesNotMatch(app,/Aumentar preço automaticamente|Criar promoção automaticamente/);
});
