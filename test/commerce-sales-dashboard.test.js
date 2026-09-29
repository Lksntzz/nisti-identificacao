import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Painel de Vendas está disponível na navegação comercial', () => {
  const app = read('src/commerce-admin-app-v2.jsx');
  assert.equal(app.includes("{ id: 'sales', label: 'Vendas', icon: 'chart' }"), true);
  assert.equal(app.includes("<CommerceSalesDashboard key={salesRevision} />"), true);
  assert.equal(app.includes("sales: 'Painel de Vendas'"), true);
});

test('Painel de Vendas usa o layout comercial aprovado', () => {
  const ui = read('src/commerce-sales-dashboard.jsx');
  for (const text of [
    'Faturamento',
    'Pedidos',
    'Unidades',
    'Ticket médio',
    'Filtros de vendas',
    'Plataforma',
    'Período inicial',
    'Período final',
    'Buscar SKU ou produto',
    'Evolução de vendas',
    'Resumo por plataforma',
    'Participação de vendas',
    'Vendas por produto',
    'Exportar'
  ]) {
    assert.equal(ui.includes(text), true, text);
  }
  assert.equal(ui.includes('SEM VENDA'), true);
  assert.equal(ui.includes("appliedStatus === 'SEM VENDA' ? []"), true);
  assert.equal(ui.includes("applySelectFilter('platform'"), true);
  assert.equal(ui.includes("applySelectFilter('periodStart'"), true);
  assert.equal(ui.includes("applySelectFilter('periodEnd'"), true);
  assert.equal(ui.includes("applySelectFilter('status'"), true);
  assert.equal(ui.includes('requestIdRef'), true);
  assert.equal(ui.includes('exportFiltered'), true);
  assert.equal(ui.includes('PlatformSummary'), true);
  assert.equal(ui.includes('ParticipationCard'), true);
  assert.equal(ui.includes('SalesChart'), true);
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
