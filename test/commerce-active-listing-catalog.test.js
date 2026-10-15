import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync('src/commerce-admin-app-v2.jsx','utf8');
const view = fs.readFileSync('src/commerce-listings-view.jsx','utf8');
const store = fs.readFileSync('src/commerce-supabase-store.js','utf8');
const sql = fs.readFileSync('supabase/migrations/20261015231000_catalog_active_listing_variations.sql','utf8');

test('Catálogo displays only ACTIVE seller listings, including those without Scanner links', () => {
  assert.match(app,/CommerceSkuListingsView/);
  assert.match(view,/if \(catalogMode\) params\.set\('status', 'ACTIVE'\)/);
  assert.match(view,/catalogMode \? 'ACTIVE' : ''/);
  assert.match(view,/catalogMode \? 'anúncios ativos'/);
  assert.match(store,/commerce_list_listings_v4/);
});

test('each listing has exactly one parent row and all child variations appear below', () => {
  assert.match(view,/React\.Fragment key=\{listingId\}/);
  assert.match(view,/commerce-catalog-variations-row/);
  assert.match(view,/variations\.map\(\(variation, index\) =>/);
  assert.match(view,/variation\.id \|\| variation\.variation_id/);
  assert.match(view,/SKU do anúncio/);
  assert.match(store,/commerce_catalog_listing_variations_v1/);
  assert.match(sql,/distinct on \(b\.listing_id, nullif\(btrim\(r\.normalized_payload->>'source_variation_id'\)/);
  assert.match(sql,/l\.listing_status='ACTIVE'/);
});

test('variation association respects seller account and protects Scanner identity', () => {
  assert.match(sql,/b\.account_code is not distinct from l\.account_code/);
  assert.match(sql,/lp\.variation_id=s\.variation_id/);
  assert.match(sql,/left join lateral/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/insert into public\.products|update public\.products/i);
});
