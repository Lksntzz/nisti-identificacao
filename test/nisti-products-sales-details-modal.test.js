import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const view=fs.readFileSync(new URL('../src/admin/CatalogView.jsx',import.meta.url),'utf8');

test('NISTI products removes sales column and shows a sales action alongside eye and pencil',()=>{
  assert.doesNotMatch(view,/<th>VENDAS E PROJEÇÃO<\/th>/);
  assert.doesNotMatch(view,/className="nisti-product-sales-cell"/);
  assert.match(view,/title="Ver vendas e projeção"/);
  assert.match(view,/title="Visualizar detalhes"/);
  assert.match(view,/title="Editar produto"/);
  assert.match(view,/onClick=\{\(\) => setSalesProduct\(product\)\}/);
  assert.match(view,/colSpan="6"/);
});

test('sales action opens a dialog with detailed monthly metrics and history',()=>{
  assert.match(view,/role="dialog" aria-modal="true"/);
  assert.match(view,/Vendas do mês/);
  assert.match(view,/Saída por dia/);
  assert.match(view,/Projeção do mês/);
  assert.match(view,/Média mensal histórica/);
  assert.match(view,/Histórico mensal de vendas/);
  assert.match(view,/report\.history/);
  assert.match(view,/planningError/);
  assert.match(view,/setSalesProduct\(null\)/);
});

test('sales dialog includes platform-specific filters and selectable chart modes',()=>{
  assert.match(view,/setSalesPlatform/);
  assert.match(view,/value="MERCADO_LIVRE"/);
  assert.match(view,/value="ML_NOVO"/);
  assert.match(view,/value="ML_ANTIGO"/);
  assert.match(view,/setSalesMonths/);
  assert.match(view,/setSalesChartType/);
  assert.match(view,/SalesTrendChart history=\{history\} mode=\{salesChartType\}/);
  assert.match(view,/role="img"/);
  assert.match(view,/ids:String\(id\)/);
});
