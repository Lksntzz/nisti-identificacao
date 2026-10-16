import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const dashboard=read('src/commerce-commercial-dashboard.jsx');
const detail=read('src/commerce-abc-ad-performance.jsx');
const css=read('src/commerce-abc-ad-performance.css');
const store=read('src/commerce-supabase-store.js');
const router=read('src/commerce-admin-router.js');
const abcSql=read('supabase/migrations/20261016010000_commerce_sales_abc_v1.sql');
const adSql=read('supabase/migrations/20261016020000_commerce_sales_abc_ads_v1.sql');
const catalogSql=read('supabase/migrations/20261016021000_catalog_normalized_sku_search_from_abc.sql');

test('clicking A/B/C opens a functional detailed seller-ad list under the curve cards',()=>{
  assert.match(dashboard,/onClick=\{\(\)=>setActiveCurve\(v=>v===curve\.code\?'':curve\.code\)\}/);
  assert.match(dashboard,/activeCurve && \(/);
  assert.match(dashboard,/CommerceAbcAdPerformance/);
  assert.match(dashboard,/curve=\{activeCurve\}/);
  assert.doesNotMatch(dashboard,/disabled=\{!hasSales\}/);
  assert.match(detail,/\/sales\/abc\/advertisements\?/);
  assert.match(detail,/Anúncios da Curva \{curve\}/);
  assert.match(detail,/setOffset\(v=>v\+PAGE_SIZE\)/);
  assert.match(detail,/setOffset\(v=>Math\.max\(0,v-PAGE_SIZE\)\)/);
  assert.match(css,/\.nisti-abc-ad-product/);
});

test('SKU total shows actual imported units and revenue without duplicating across multiple seller ads',()=>{
  assert.match(detail,/Unidades vendidas · SKU/);
  assert.match(detail,/Faturamento · SKU/);
  assert.match(detail,/item\.url/);
  assert.match(detail,/item\.id/);
  assert.match(detail,/registro manual/i);
  assert.match(detail,/Registros manuais não são somados ao faturamento importado/);
  assert.match(detail,/Venda importada por anúncio não disponível/);
  assert.match(adSql,/commerce_sales_abc_v1\(p_platform,p_period_start,p_period_end,p_basis\)/);
  assert.match(adSql,/coalesce\(a\.advertisements,'\[\]'::jsonb\)/);
  assert.match(adSql,/'units',r\.units/);
  assert.match(adSql,/'revenue',r\.revenue/);
  assert.doesNotMatch(adSql,/insert into|update public\.commerce_sales_rows/i);
});

test('advertisement matching is grounded in the current import and listing IDs, including variations',()=>{
  assert.match(adSql,/commerce_import_rows r/);
  assert.match(adSql,/latest_import b on b\.id=r\.batch_id/);
  assert.match(adSql,/l\.account_code is not distinct from b\.account_code/);
  assert.match(adSql,/l\.external_listing_id=r\.normalized_payload->>'external_listing_id'/);
  assert.match(adSql,/l\.listing_status='ACTIVE'/);
  assert.match(adSql,/commerce_nisti_sku_norm_v1\(r\.normalized_payload->>'sku_primary'\)/);
  assert.match(adSql,/commerce_listing_products lp/);
  assert.match(adSql,/source_variation_id/);
  assert.match(adSql,/'variations',variations/);
  assert.match(adSql,/manual\.manual_units/);
  assert.match(adSql,/public\.commerce_manual_listing_sales s/);
  assert.match(adSql,/s\.listing_id=l\.id/);
  assert.match(adSql,/to service_role/);
  assert.doesNotMatch(adSql,/grant execute[^;]+to anon|grant execute[^;]+to authenticated/i);
});

test('ABC drill-down preserves original catalog with SKU normalized search and no destructive writes',()=>{
  assert.match(dashboard,/CommerceSkuListingsView key=\{salesRevision\+'-'\+refresh\} catalogMode embedded/);
  assert.match(dashboard,/onShowInCatalog=\{sku=>/);
  assert.match(dashboard,/setSearch\(sku\)/);
  assert.match(catalogSql,/commerce_nisti_sku_norm_v1\(k\.source_sku\)=public\.commerce_nisti_sku_norm_v1\(i\.q\)/);
  assert.doesNotMatch(catalogSql,/insert into public\.products|delete from public\.products/i);
  assert.match(abcSql,/from public\.commerce_sales_rows r/);
  assert.match(store,/commerce_sales_abc_ads_v1/);
  assert.match(router,/\/sales\/abc\/advertisements/);
  assert.match(router,/\['A','B','C'\]\.includes\(curve\)/);
});

test('no import results in a clear empty state, not invented sales or disabled ABC controls',()=>{
  assert.match(detail,/Ainda não há vendas importadas/);
  assert.match(detail,/Utilize o card Importar arquivos neste Painel Comercial/);
  assert.match(detail,/payload\?\.has_sales===false/);
  assert.match(detail,/Nenhum SKU pertence a esta curva/);
});
