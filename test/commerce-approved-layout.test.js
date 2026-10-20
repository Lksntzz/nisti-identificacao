import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const evolution=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const css=fs.readFileSync('src/commerce-approved-layout.css','utf8');
const viewCss=fs.readFileSync('src/commerce-view-specific-kpis.css','utf8');

test('anúncios e evolução possuem indicadores próprios, com bases de dados distintas',()=>{
  assert.match(manager,/commercialView==='LISTINGS'\?/);
  assert.match(manager,/nim-kpis-listings/);
  assert.match(manager,/nim-kpis-evolution/);
  for(const label of ['Anúncios ativos','Com vendas identificadas','Sem vendas identificadas',
    'Em queda','Sem vendas','Com vendas','Crescimento'])
    assert.ok(manager.includes(label),label);
  assert.match(manager,/value=\{evolutionCount\('falling'\)\}/);
  assert.match(manager,/value=\{evolutionCount\('zero'\)\}/);
  assert.match(manager,/value=\{evolutionCount\('sold'\)\}/);
  assert.match(manager,/value=\{evolutionCount\('rising'\)\}/);
  assert.doesNotMatch(manager,/value=\{28\}|value=\{41\}/);
  assert.doesNotMatch(manager,/trendOverview|trendRequest/);
});

test('cards filtram a evolução pelo mesmo estado do seletor; anúncios preservam filtros separados',()=>{
  for(const status of ['FALLING','ZERO','SOLD','RISING'])
    assert.ok(manager.includes("chooseEvolutionStatus('"+status+"')"),status);
  assert.match(manager,/setEvolutionStatus\(current=>current===next\?'ALL':next\)/);
  assert.match(manager,/status=\{evolutionStatus\} onStatusChange=\{setEvolutionStatus\}/);
  assert.match(manager,/onSummary=\{setEvolutionSummary\}/);
  assert.match(manager,/onClick=\{\(\)=>change\(setStatus,status==='SOLD'\?'ALL':'SOLD'\)\}/);
  assert.match(evolution,/onChange=\{e=>onStatusChange\(e\.target\.value\)\}/);
  assert.match(evolution,/onSummary\(body\?\.kpis\|\|null\)/);
  assert.match(evolution,/setDays\(selected\);onPeriodChange\(selected\)/);
  assert.match(manager,/if\(!financialOpen\|\|!data\?\.period_start/);
  assert.match(manager,/Totais financeiros importados/);
});

test('a evolução conserva a tabela analítica, detalhes e design responsivo',()=>{
  for(const label of ['Produto','Plataforma','SKU / Anúncio','Situação','Vendas no período','Variação'])
    assert.ok(evolution.includes(label),label);
  assert.match(evolution,/<details className="nim-evolution-product"/);
  assert.match(evolution,/<summary className="nim-evolution-product-head"/);
  assert.match(evolution,/item\.growth_pct==null\?'—'/);
  assert.match(evolution,/item\.listing_id/);
  assert.match(evolution,/item\.current_units/);
  assert.match(evolution,/Ação comercial sugerida/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/@media\(max-width:1050px\)/);
  assert.match(viewCss,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(viewCss,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
});
