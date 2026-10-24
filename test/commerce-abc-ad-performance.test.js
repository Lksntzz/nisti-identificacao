import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const store=read('src/commerce-supabase-store.js');
const router=read('src/commerce-admin-router.js');
const abcSql=read('supabase/migrations/20261016010000_commerce_sales_abc_v1.sql');
const adSql=read('supabase/migrations/20261016020000_commerce_sales_abc_ads_v1.sql');
const catalogSql=read('supabase/migrations/20261016021000_catalog_normalized_sku_search_from_abc.sql');

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
