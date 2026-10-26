import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(p,'utf8');
const sql=read('supabase/migrations/20261016060000_commerce_scanner_pending_active_v1.sql');
const store=read('src/commerce-supabase-store.js');
const router=read('src/commerce-admin-router.js');

test('every active catalog seller SKU, including nested variations, enters independent Scanner pending queue',()=>{
  assert.match(sql,/commerce_active_product_catalog_v1/);
  assert.match(sql,/where listing_status='ACTIVE'/);
  assert.match(sql,/sku_references as/);
  assert.match(sql,/jsonb_array_elements\(coalesce\(ad.value->'variations'/);
  assert.match(sql,/v\.value->>'id'/);
  assert.match(sql,/commerce_listing_products lp/);
  assert.match(sql,/commerce_nisti_product_links nl/);
  assert.match(sql,/nl\.sync_status='SYNCED'/);
  assert.match(sql,/public\.commerce_nisti_sku_norm_v1\(p\.sku\)=r\.normalized_sku/);
  assert.match(sql,/where not confirmed/);
  assert.match(sql,/'scanner_matches'/);
  assert.match(sql,/'scanner_product_id'/);
  assert.match(sql,/'external_listing_id'/);
  assert.match(store,/commerce_scanner_pending_active_v1/);
  assert.match(router,/\/scanner-pending/);
});

test('Scanner linkage only after manual confirmation and exact verified identity',()=>{
  assert.match(sql,/v_sku_norm is distinct from public\.commerce_nisti_sku_norm_v1\(v_product\.sku\)/);
  assert.match(sql,/v_others<>1/);
  assert.match(sql,/v_variations<>1/);
  assert.match(sql,/scanner_link_master_conflict/);
  assert.match(sql,/scanner_link_listing_already_associated/);
  assert.match(sql,/bx\.account_code is not distinct from v_listing\.account_code/);
  assert.match(sql,/bx\.created_at desc,bx\.id desc limit 1/);
  assert.match(sql,/v_listing\.id is null/);
  assert.match(sql,/commerce_listing_products\(/);
  assert.match(sql,/commerce_nisti_product_links\(/);
  assert.doesNotMatch(sql,/insert into public\.products\b|update public\.products\b|delete from public\.products\b/i);
});

test('admin RPCs run as invoker, restricted to service role with server-side argument checks',()=>{
  assert.match(sql,/security invoker/);
  assert.match(sql,/revoke all on function public\.commerce_link_active_ad_scanner_v1/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.match(router,/positiveId\(body\?\.listing_id\)/);
  assert.match(router,/positiveId\(body\?\.scanner_product_id\)/);
  assert.match(store,/commerce_link_active_ad_scanner_v1/);
});

