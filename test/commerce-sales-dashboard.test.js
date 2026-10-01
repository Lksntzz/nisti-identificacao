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
    'Produtos vendidos',
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

test('Modo SEM VENDA usa arquitetura profissional por Produto Mestre', () => {
  const dashboard = read('src/commerce-sales-dashboard.jsx');
  const performance = read('src/commerce-sales-product-performance.jsx');
  const css = read('src/commerce-sales-product-performance.css');
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const rpc = read('supabase/migrations/20260929150500_commerce_sales_product_performance_v1.sql');

  assert.equal(dashboard.includes('CommerceSalesProductPerformance'), true);
  assert.equal(dashboard.includes("Buscar SKU ou produto"), true);

  for (const text of [
    'Produtos analisados',
    'Produtos com venda',
    'Produtos sem venda',
    'Vendem em outra plataforma',
    'Sem anúncio',
    'Revisar para desativar',
    'Tem oportunidade',
    'Criar anúncio',
    'Distribuição por situação',
    'Comparação por plataforma',
    'Tendência de sem venda',
    'Insights automáticos',
    'Desempenho por Produto',
    'Recomendação',
    'Shopee',
    'ML Novo',
    'ML Antigo',
    'Todas as situações',
    'Ver anúncios',
    'Exportar'
  ]) {
    assert.equal(performance.includes(text), true, text);
  }

  for (const token of [
    '.spp-kpi-grid',
    '.spp-decision-grid',
    '.spp-analytics-grid',
    '.spp-chart-card',
    '.spp-insights-card',
    '.spp-table',
    '.spp-status.sold',
    '.spp-status.no-sales',
    '.spp-status.elsewhere',
    '.spp-status.no-listing',
    '.spp-recommendation',
    '@keyframes spp-rise',
    '@keyframes spp-draw',
    '@media(prefers-reduced-motion:reduce)'
  ]) {
    assert.equal(css.includes(token), true, token);
  }

  assert.equal(router.includes('/sales/product-performance'), true);
  assert.equal(router.includes('commerceSalesProductPerformance'), true);
  assert.equal(store.includes('commerce_sales_product_performance_v1'), true);

  for (const token of [
    'commerce_products',
    'commerce_product_skus',
    'commerce_sales_rows',
    'SHOPEE_GESTAO',
    'ML_NOVO_GESTAO',
    'ML_ANTIGO_GESTAO',
    'VENDEU',
    'NAO_VENDEU',
    'VENDE_OUTRA_PLATAFORMA',
    'SEM_ANUNCIO'
  ]) {
    assert.equal(rpc.includes(token), true, token);
  }
});


test('Produtos vendidos exibem imagem real e SKU da venda', () => {
  const ui = read('src/commerce-sales-dashboard.jsx');
  const css = read('src/commerce-sales-dashboard.css');
  const rpc = read('supabase/migrations/20260929171000_sales_dashboard_product_images.sql');

  assert.equal(ui.includes('sales-product-image'), true);
  assert.equal(ui.includes('SKU vendido'), true);
  assert.equal(ui.includes('ProductCutoutImage'), true);
  assert.equal(ui.includes('src={item.image_url}'), true);
  assert.equal(ui.includes("SKU vendido: {item.sku || '—'}"), true);

  assert.equal(css.includes('.sales-product-image'), true);
  assert.equal(css.includes('object-fit:cover'), true);

  for (const token of [
    'sales_product_images',
    "'image_url',pi.image_url",
    'commerce_product_id',
    'shopee_snapshot',
    'cover_image_url',
    'commerce_image_years_compatible'
  ]) {
    assert.equal(rpc.includes(token), true, token);
  }
});
