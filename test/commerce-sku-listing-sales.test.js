import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell = fs.readFileSync('src/main.jsx','utf8');
const separate = fs.readFileSync('src/commerce-admin-app-v2.jsx','utf8');
const api = fs.readFileSync('src/commerce-admin-router.js','utf8');
const store = fs.readFileSync('src/commerce-supabase-store.js','utf8');
const sql = fs.readFileSync('supabase/migrations/20261015234500_commerce_sku_listing_manual_sales.sql','utf8');
const activeEanMigration = fs.readFileSync('supabase/migrations/20261015235500_sku_catalog_active_eans.sql','utf8');

test('only registered active EANs are shown; no new barcode or Scanner products are generated', () => {
  assert.match(activeEanMigration,/from public\.product_gtins g/);
  assert.match(activeEanMigration,/g\.product_id=e\.product_id and g\.active=true/);
  assert.match(activeEanMigration,/jsonb_agg\(g\.gtin/);
  assert.doesNotMatch(activeEanMigration,/insert into/i);
  assert.doesNotMatch(activeEanMigration,/update public\.products/i);
});
