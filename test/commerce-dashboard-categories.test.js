import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pickSummaryYear,summarizeCategories} from '../src/commerce-dashboard-categories-logic.js';

test('resumo de categorias: ano mais recente com histórico do ano anterior na plataforma', () => {
  const cov=[{platform:'SHOPEE',year:2025,units:100},{platform:'SHOPEE',year:2026,units:50},{platform:'ML_NOVO',year:2026,units:9}];
  assert.equal(pickSummaryYear(cov,'SHOPEE'),2026);
  assert.equal(pickSummaryYear(cov,'TODAS'),2026);
  assert.equal(pickSummaryYear(cov,'ML_NOVO'),null);
  assert.equal(pickSummaryYear([],'SHOPEE'),null);
});

test('resumo de categorias: top 5 por unidades, maior alta e maior queda', () => {
  const cats=[{name:'A',cur:100,base:50},{name:'B',cur:80,base:200},{name:'C',cur:60,base:0},{name:'D',cur:50,base:50},{name:'E',cur:40,base:30},{name:'F',cur:10,base:5}];
  const s=summarizeCategories(cats);
  assert.deepEqual(s.top.map(c=>c.name),['A','B','C','D','E']);
  assert.equal(s.rise.name,'C');
  assert.equal(s.fall.name,'B');
  assert.equal(s.max,200);
  const none=summarizeCategories([]);
  assert.equal(none.top.length,0);
  assert.equal(none.rise,null);
});

test('Dashboard mostra o resumo só no modo overview, depois do carregamento, e leva à tela Categorias', () => {
  const dash=fs.readFileSync('src/commerce-dashboard.jsx','utf8');
  assert.match(dash,/mode==='overview'&&hasData&&<Panel title="Categorias"/);
  assert.match(dash,/<CategoriesSummary platform=\{platform\} onOpen=\{onOpenCategories\}\/>/);
  const app=fs.readFileSync('src/commerce-admin-app-v2.jsx','utf8');
  assert.match(app,/onOpenCategories=\{\(\) => \{ setCommercialView\('categories'\); setActiveView\('catalog'\); \}\}/);
  const ui=fs.readFileSync('src/commerce-dashboard-categories.jsx','utf8');
  assert.match(ui,/sales-compare\/annual-coverage/);
  assert.match(ui,/Não segue o filtro de dias do Dashboard/);
});
