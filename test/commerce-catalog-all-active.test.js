import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(name,'utf8');
const sql = read('supabase/migrations/20261016003000_commerce_active_catalog_independent_of_scanner.sql');
const view = read('src/commerce-sku-listings-view.jsx');
const main = read('src/main.jsx');
const commerce = read('src/commerce-admin-app-v2.jsx');
const router = read('src/commerce-admin-router.js');
const store = read('src/commerce-supabase-store.js');

test('Catálogo is backed by ALL ACTIVE listing IDs, not only linked Scanner products', () => {
  assert.match(main,/commerceSection === 'catalog' && <CommerceSkuListingsView catalogMode/);
  assert.match(commerce,/activeView === 'catalog' && <CommerceSkuListingsView catalogMode/);
  assert.match(router,/\/catalog\/active-products/);
  assert.match(store,/commerce_active_product_catalog_v1/);
  assert.match(view,/catalogMode\s*\?\s*'\/api\/admin\/commerce\/catalog\/active-products\?'/);
  assert.match(sql,/from public\.commerce_listings l/);
  assert.match(sql,/where l\.listing_status='ACTIVE'/);
  assert.match(sql,/from active_ads a/);
  assert.doesNotMatch(sql,/from public\.products p\s+join public\.commerce_listings/i);
  assert.doesNotMatch(sql,/insert into public\.products/i);
});

test('the same product shares a card while each genuine marketplace listing ID remains clickable', () => {
  assert.match(sql,/when r\.sku_count=1 and r\.source_sku is not null then 'SKU:'/);
  assert.match(sql,/when r\.nisti_product_id is not null then 'PRODUCT:'/);
  assert.match(sql,/jsonb_agg\(jsonb_build_object\(/);
  assert.match(sql,/'external_listing_id',a\.external_listing_id/);
  assert.match(sql,/'active_ads',\(select count\(\*\) from active_ads\)/);
  assert.match(view,/productKey = product\.key \|\| product\.product_id/);
  assert.match(view,/href=\{listing\.url\}/);
  assert.match(view,/className="commerce-sku-expand"/);
});

test('variation IDs stay nested under one main active listing, including unlinked listings', () => {
  assert.match(sql,/when r\.has_variations or r\.sku_count>1 then 'AD:'/);
  assert.match(sql,/commerce_catalog_listing_variations_v1/);
  assert.match(sql,/'variations',coalesce\(v\.variations/);
  assert.match(view,/listing\.variations\.map\(variation =>/);
  assert.match(view,/variation\.current_sku \|\| variation\.sku/);
  assert.match(view,/commerce-sku-variations/);
  assert.doesNotMatch(sql,/join public\.products p on p\.id=l\.id/i);
});

test('separate Sales panel remains SKU-linked, with no change to manual monthly sales', () => {
  assert.match(view,/salesMode = false, catalogMode = false/);
  assert.match(view,/\/api\/admin\/commerce\/sku-listings\?/);
  assert.match(view,/\/api\/admin\/commerce\/sales\/manual-listing/);
  assert.doesNotMatch(sql,/insert into public\.commerce_manual_listing_sales/i);
});
