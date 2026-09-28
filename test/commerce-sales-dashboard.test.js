import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Painel de Vendas está disponível na navegação comercial', () => {
  const app = read('src/commerce-admin-app-v2.jsx');
  assert.equal(app.includes("{ id: 'sales', label: 'Vendas', icon: 'chart' }"), true);
  assert.equal(app.includes("<CommerceSalesDashboard />"), true);
});

test('Painel de Vendas preserva filtros e indicadores da planilha', () => {
  const ui = read('src/commerce-sales-dashboard.jsx');
  for (const text of ['Plataforma','Mês inicial','Mês final','Status de venda','SKU (opcional)','Pedidos líquidos','Unidades vendidas','Faturamento produto','Anúncios com venda','Vendas por item','Histórico mensal']) {
    assert.equal(ui.includes(text), true, text);
  }
  assert.equal(ui.includes('SEM VENDA'), true);
  assert.equal(ui.includes('Abrir anúncio'), true);
});

test('API e banco usam a base normalizada de vendas', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const schema = read('supabase/migrations/20260928203447_commerce_sales_tables_v1.sql');
  const rpc = read('supabase/migrations/20260928203528_commerce_sales_dashboard_rpc_v1.sql');

  assert.equal(router.includes('/sales/dashboard'), true);
  assert.equal(store.includes('commerce_sales_dashboard_v1'), true);
  assert.equal(schema.includes('commerce_sales_rows'), true);
  assert.equal(schema.includes('commerce_sales_summary_rows'), true);
  assert.equal(rpc.includes('items_without_sales'), true);
  assert.equal(rpc.includes('listings_with_sales'), true);
  assert.equal(rpc.includes('ML_NOVO_GESTAO'), true);
  assert.equal(rpc.includes('ML_ANTIGO_GESTAO'), true);
});
