import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync('src/main.jsx','utf8');
const separate = fs.readFileSync('src/commerce-admin-app-v2.jsx','utf8');
const sales = fs.readFileSync('src/commerce-sales-dashboard.jsx','utf8');
const grouped = fs.readFileSync('src/commerce-sku-listings-view.jsx','utf8');
const api = fs.readFileSync('src/commerce-admin-router.js','utf8');
const store = fs.readFileSync('src/commerce-supabase-store.js','utf8');
const sql = fs.readFileSync('supabase/migrations/20261015234500_commerce_sku_listing_manual_sales.sql','utf8');

test('the existing Admin and Commerce Catalog show one product per canonical SKU', () => {
  assert.match(shell,/commerceSection === 'catalog' && <CommerceSkuListingsView/);
  assert.match(separate,/activeView === 'catalog' && <CommerceSkuListingsView/);
  assert.match(grouped,/items\.map\(product=>/);
  assert.match(grouped,/listings\.map\(listing=>/);
  assert.match(sql,/select distinct on \(p\.id,l\.id\)/);
  assert.match(sql,/nl\.sync_status='SYNCED'/);
  assert.match(sql,/l\.listing_status='ACTIVE'/);
  assert.doesNotMatch(sql,/insert into public\.products/i);
});

test('Sales Dashboard tracks monthly quantities separately for every seller listing', () => {
  assert.match(sales,/<CommerceSkuListingsView salesMode \/>/);
  assert.match(grouped,/listing\.external_listing_id/);
  assert.match(grouped,/listing\.variation_id/);
  assert.match(grouped,/commerce\/sales\/manual-listing/);
  assert.match(store,/commerce_save_listing_sales_v1/);
  assert.match(api,/commerceSaveListingSales/);
  assert.match(sql,/primary key \(listing_id,nisti_product_id,period_month\)/);
  assert.match(sql,/on conflict\(listing_id,nisti_product_id,period_month\)/);
  assert.match(sql,/listing_product_link_not_verified/);
  assert.doesNotMatch(sql,/insert into public\.commerce_sales_rows/i);
});

test('manual sale functions are restricted and do not modify imported sales snapshots', () => {
  assert.match(sql,/enable row level security/);
  assert.match(sql,/grant execute on function public\.commerce_save_listing_sales_v1[\s\S]*to service_role/);
  assert.match(sql,/revoke all on function public\.commerce_save_listing_sales_v1[\s\S]*from public,anon,authenticated/);
  assert.match(grouped,/não são somados ao faturamento/);
});
