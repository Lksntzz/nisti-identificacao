import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(p,'utf8');
const view = read('src/commerce-commercial-dashboard.jsx');
const css = read('src/commerce-commercial-dashboard.css');
const store = read('src/commerce-supabase-store.js');
const router = read('src/commerce-admin-router.js');
const nav = read('src/admin-navigation.js');
const main = read('src/main.jsx');
const independent = read('src/commerce-sku-listings-view.jsx');
const abc = read('supabase/migrations/20261016010000_commerce_sales_abc_v1.sql');
const cat = read('supabase/migrations/20261016011000_commerce_catalog_abc_sku_normalization.sql');

test('Painel Comercial is a single menu entry with embedded imports; Pendências remain separate', () => {
  assert.match(nav,/label: 'Painel Comercial'/);
  assert.match(nav,/id: 'catalog', label: 'Painel Comercial'/);
  assert.doesNotMatch(nav,/id: 'sales', label: 'Vendas'/);
  assert.doesNotMatch(nav,/id: 'import-center'/);
  assert.match(view,/CommerceImportCenter embedded/);
  assert.match(nav,/id: 'pending', label: 'Pendências'/);
  assert.match(main,/CommerceCommercialDashboard/);
});

test('unified dashboard preserves true active-ad catalog independent of Scanner links', () => {
  assert.match(view,/CommerceSkuListingsView/);
  assert.match(view,/catalogMode embedded/);
  assert.match(view,/catalog\/active-products/);
  assert.match(independent,/externalPlatform/);
  assert.match(independent,/commerce-sku-variations/);
  assert.match(independent,/commerce-sku-expand/);
  assert.match(cat,/from public\.commerce_listings l/);
  assert.match(cat,/where l\.listing_status='ACTIVE'/);
  assert.match(cat,/'sku_norm',public\.commerce_nisti_sku_norm_v1\(g\.sku\)/);
  assert.doesNotMatch(cat,/insert into public\.products/i);
});

test('ABC rankings use current imported sales only, not manual quantities or mock totals', () => {
  assert.match(abc,/from public\.commerce_sales_rows r/);
  assert.match(abc,/where s\.is_current=true/);
  assert.match(abc,/public\.commerce_nisti_sku_norm_v1/);
  assert.match(abc,/when preceding_score < grand_total\*0\.80 then 'A'/);
  assert.match(abc,/when preceding_score < grand_total\*0\.95 then 'B'/);
  assert.doesNotMatch(abc,/commerce_manual_listing_sales/);
  assert.doesNotMatch(abc,/insert into|update public\.commerce_sales/i);
  assert.match(router,/\/sales\/abc/);
  assert.match(store,/commerce_sales_abc_v1/);
  assert.match(view,/Aguardando importação/);
  assert.match(view,/!hasSales/);
  assert.match(view,/basis==='UNITS'/);
});

test('old detailed sales dashboard stays available inside the unified panel', () => {
  assert.match(view,/CommerceSalesDashboard/);
  assert.match(view,/Abrir análise detalhada de vendas/);
  assert.match(view,/className="nisti-com-deep-dive"/);
  assert.match(view,/details&&/);
  assert.match(css,/\.nisti-com-abc-cards/);
  assert.match(css,/\.nisti-com-metrics/);
  assert.match(css,/@media\(max-width:680px\)/);
});

test('ABC card click opens seller-ad performance panel without invented listing sales', () => {
  assert.match(view,/CommerceAbcAdPerformance/);
  assert.match(view,/activeCurve && \(/);
  assert.match(view,/curve={activeCurve}/);
  assert.match(view,/onShowInCatalog={sku=>/);
  assert.match(view,/setSearch\(sku\)/);
  assert.match(view,/setActiveCurve\(''\)/);
  assert.doesNotMatch(view,/listing\.manual_units\+/);
  assert.match(view,/Aguardando importação das vendas/);
});
