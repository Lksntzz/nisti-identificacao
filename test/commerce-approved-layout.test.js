import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const evolution=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const css=fs.readFileSync('src/commerce-approved-layout.css','utf8');

test('cinco KPIs do gestor seguem o escopo aprovado e não inventam os números de tendência',()=>{
  for (const label of ['Anúncios ativos','Com vendas','Sem vendas','Em alta','Em queda'])
    assert.ok(manager.includes(label),label);
  assert.match(manager,/value=\{trendAvailable\?num\(trendCounts\.rising\):'—'\}/);
  assert.match(manager,/value=\{trendAvailable\?num\(trendCounts\.falling\):'—'\}/);
  assert.match(manager,/\['TODAS','MERCADO_LIVRE','ML_ANTIGO','ML_NOVO','SHOPEE'\]\.includes\(platform\)/);
  assert.match(manager,/status:'ALL',limit:'1',offset:'0'/);
  assert.match(manager,/trendScope=platform==='TODAS'/);
  assert.match(manager,/SKU\/modelos/);
  assert.doesNotMatch(manager,/value=\{28\}|value=\{41\}/);
});

test('cards levam ao painel adequado sem mexer em status, filtros e análises existentes',()=>{
  assert.match(manager,/showTrend\('RISING'\)/);
  assert.match(manager,/showTrend\('FALLING'\)/);
  assert.match(manager,/setCommercialView\('EVOLUTION'\)/);
  assert.match(manager,/setCommercialView\('LISTINGS'\)/);
  assert.match(manager,/onPeriodChange=\{setDays\}/);
  assert.match(evolution,/setDays\(selected\);onPeriodChange\(selected\)/);
  assert.match(evolution,/if\(trendRequest\?\.status\)setStatus\(trendRequest\.status\)/);
  assert.match(manager,/if\(!financialOpen\|\|!data\?\.period_start/);
  assert.match(manager,/Totais financeiros importados/);
});

test('evolução usa cabeçalho tabular, detalhes nativos, dados reais e layout responsivo',()=>{
  for (const label of ['Produto','Plataforma','SKU / Anúncio','Situação','Vendas no período','Variação'])
    assert.ok(evolution.includes(label),label);
  assert.match(evolution,/<details className="nim-evolution-product"/);
  assert.match(evolution,/<summary className="nim-evolution-product-head"/);
  assert.match(evolution,/item\.growth_pct==null\?'—'/);
  assert.match(evolution,/item\.listing_id/);
  assert.match(evolution,/item\.current_units/);
  assert.match(evolution,/Ação comercial sugerida/);
  assert.match(css,/@media\(max-width:700px\)/);
  assert.match(css,/@media\(max-width:1050px\)/);
  assert.match(css,/\.nim-manager \.nim-kpis\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});
