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
    'Buscar SKU',
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
  assert.equal(ui.includes('AnimatedMetricValue'), true);
  assert.equal(ui.includes('sales-chart-tooltip'), true);
  assert.equal(ui.includes('setHoveredIndex'), true);
  assert.equal(ui.includes('showRevenue'), true);
  assert.equal(ui.includes('showOrders'), true);
  assert.equal(ui.includes("onSelect={platform => applySelectFilter('platform', platform)}"), true);
  assert.equal(ui.includes('sales-donut-segment'), true);
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


test('Painel de Vendas possui camada de movimento e acessibilidade de interação', () => {
  const css = read('src/commerce-sales-dashboard.css');
  for (const token of [
    '@keyframes sales-card-in',
    '@keyframes sales-bar-grow',
    '@keyframes sales-line-draw',
    '.sales-chart-tooltip',
    '.sales-chart-hit',
    '.sales-donut-segment',
    '.sales-platform-summary-row:hover',
    '@media(prefers-reduced-motion:reduce)'
  ]) {
    assert.equal(css.includes(token), true, token);
  }
});


test('Filtro SEM VENDA usa análise específica para decidir revisão dos anúncios', () => {
  const ui = read('src/commerce-sales-dashboard.jsx');
  const css = read('src/commerce-sales-dashboard.css');
  const rpc = read('supabase/migrations/20260929143041_add_no_sales_insights_to_sales_dashboard.sql');

  for (const text of [
    'Anúncios sem venda',
    'Revisar primeiro',
    'Nunca venderam na base',
    'Já venderam antes',
    'Tempo sem vender',
    'Sem vendas por plataforma',
    'Prioridade de revisão',
    'Anúncios sem venda — fila de revisão',
    'Última venda',
    'Histórico anterior',
    'Abrir anúncio',
    'anuncios_sem_venda_nisti.csv'
  ]) {
    assert.equal(ui.includes(text), true, text);
  }

  for (const token of [
    '.sales-no-sales-bars',
    '.sales-no-sales-platforms',
    '.sales-no-sales-priority-card',
    '.sales-review-priority.alta',
    '@keyframes sales-no-sales-width'
  ]) {
    assert.equal(css.includes(token), true, token);
  }

  for (const token of [
    'no_sales_insights',
    'last_sale_period',
    'periods_without_sale',
    'historical_revenue',
    'review_priority',
    'inactivity_bucket'
  ]) {
    assert.equal(rpc.includes(token), true, token);
  }
});
