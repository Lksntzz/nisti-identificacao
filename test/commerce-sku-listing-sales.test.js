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
  assert.match(shell,/commerceSection === 'catalog' \|\| commerceSection === 'sales'\) && <CommerceCommercialDashboard/);
  assert.match(separate,/activeView === 'catalog' \|\| activeView === 'sales'\) && <CommerceCommercialDashboard/);
  assert.match(grouped,/items\.map\(product\s*=>/);
  assert.match(grouped,/listings\.map\(listing\s*=>/);
  assert.match(sql,/select distinct on \(p\.id,l\.id\)/);
  assert.match(sql,/nl\.sync_status='SYNCED'/);
  assert.match(sql,/l\.listing_status='ACTIVE'/);
  assert.doesNotMatch(sql,/insert into public\.products/i);
});

test('Sales Dashboard tracks monthly quantities separately for every seller listing', () => {
  assert.match(sales,/<CommerceSkuListingsView salesMode \/>/);
  assert.match(grouped,/listing\.external_listing_id/);
  assert.match(grouped,/listing\.listing_id/);
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
  assert.doesNotMatch(sql,/insert into public\.commerce_sales_rows/i);
});

const activeEanMigration = fs.readFileSync('supabase/migrations/20261015235500_sku_catalog_active_eans.sql','utf8');
const compactCss = fs.readFileSync('src/commerce-sku-listings.css','utf8');

test('compact catalog shows only product photo, name and clickable listing IDs until expanded', () => {
  assert.match(grouped,/ProductCutoutImage/);
  assert.match(grouped,/product\.product_name/);
  assert.match(grouped,/className="commerce-sku-id-link" href=\{listing\.url\}/);
  assert.match(grouped,/target="_blank" rel="noopener noreferrer"/);
  assert.match(grouped,/className="commerce-sku-expand"/);
  assert.match(grouped,/aria-expanded=\{isExpanded\}/);
  assert.match(grouped,/isExpanded && \(/);
  assert.match(grouped,/\{product\.sku \|\| 'Consulte as variações abaixo'\}/);
  assert.match(grouped,/Array\.isArray\(product\.eans\)/);
  assert.match(grouped,/eans\.map\(ean =>/);
  assert.doesNotMatch(grouped,/\{listing\.title \|\| 'Anúncio sem título'\}/);
  assert.match(compactCss,/\.commerce-sku-product-main/);
});

test('only registered active EANs are shown; no new barcode or Scanner products are generated', () => {
  assert.match(activeEanMigration,/from public\.product_gtins g/);
  assert.match(activeEanMigration,/g\.product_id=e\.product_id and g\.active=true/);
  assert.match(activeEanMigration,/jsonb_agg\(g\.gtin/);
  assert.doesNotMatch(activeEanMigration,/insert into/i);
  assert.doesNotMatch(activeEanMigration,/update public\.products/i);
});

test('sales quantity entry stays accessible in expanded listing details only', () => {
  const collapsePos = grouped.indexOf('{isExpanded && (');
  const salesPos = grouped.indexOf('{salesMode && (', collapsePos);
  assert.ok(collapsePos >= 0 && salesPos > collapsePos);
  assert.match(grouped,/commerce-sku-manual-sale/);
});

test('one + button is placed at the end of each product card, not beside each listing ID', () => {
  assert.match(grouped,/const isExpanded = expanded\.has\(productKey\)/);
  assert.match(grouped,/onClick=\{\(\) => toggleProduct\(productKey\)\}/);
  assert.equal(grouped.split('className="commerce-sku-expand"').length - 1, 1);
  assert.equal(grouped.split('className="commerce-sku-id-link"').length - 1, 1);
  const listingLoop = grouped.indexOf('listings.map(listing => (');
  const expandButton = grouped.indexOf('className="commerce-sku-expand"');
  const metadata = grouped.indexOf('className="commerce-sku-identifiers"');
  assert.ok(listingLoop > 0 && expandButton > listingLoop && metadata > expandButton);
  assert.ok(grouped.lastIndexOf('</div>', expandButton) > listingLoop, 'listing IDs finish before product expansion');
  assert.match(compactCss,/\.commerce-sku-product-summary\{display:grid;/);
  assert.match(compactCss,/\.commerce-sku-expand\{[^}]*justify-self:end;/);
});

test('shared SKU and EAN render once for product; sales stay separate per listing ID', () => {
  assert.equal(grouped.split("<span>SKU</span>").length - 1, 1);
  assert.equal(grouped.split("<span>EAN</span>").length - 1, 1);
  assert.match(grouped,/commerce-sku-sales-list/);
  assert.match(grouped,/listings\.map\(listing => \{/);
  assert.match(grouped,/product\.product_id \+ ':' \+ listing\.listing_id/);
});
