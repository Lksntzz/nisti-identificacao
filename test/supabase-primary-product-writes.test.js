import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync(new URL('../src/core-router.js', import.meta.url), 'utf8');
const finish = fs.readFileSync(new URL('../src/product-finish-router.js', import.meta.url), 'utf8');
const gtin = fs.readFileSync(new URL('../src/gtin-router.js', import.meta.url), 'utf8');
const mirror = fs.readFileSync(new URL('../src/supabase-mutation-mirror.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(
  new URL('../supabase/migrations/20261001200000_primary_product_writes_v1.sql', import.meta.url),
  'utf8'
);

test('product CRUD and GTIN mutations have Supabase-primary branches before D1', () => {
  for (const rpc of [
    'nisti_upsert_product_primary_v1',
    'nisti_update_product_primary_v1',
    'nisti_delete_product_primary_v1'
  ]) assert.ok(core.includes(rpc));
  assert.ok(finish.includes('nisti_finish_product_primary_v1'));
  assert.ok(gtin.includes('nisti_bind_product_gtin_primary_v1'));
  assert.ok(gtin.includes('nisti_deactivate_product_gtin_primary_v1'));
  assert.ok(core.indexOf("nisti_upsert_product_primary_v1") < core.indexOf('SELECT id,image_key FROM products WHERE sku=?'));
  assert.ok(gtin.indexOf('nisti_bind_product_gtin_primary_v1') < gtin.indexOf('const product = await productExists'));
  assert.ok(mirror.includes('isDirectSupabasePrimaryMutation'));
  assert.ok(mirror.includes('supabasePrimaryWritesRequested(env) && isDirectSupabasePrimaryMutation'));
});

test('primary product RPCs are invoker-only and service-role-only', () => {
  const rpcNames = [
    'nisti_upsert_product_primary_v1', 'nisti_update_product_primary_v1',
    'nisti_finish_product_primary_v1', 'nisti_bind_product_gtin_primary_v1',
    'nisti_deactivate_product_gtin_primary_v1', 'nisti_delete_product_primary_v1'
  ];
  assert.ok(!migration.includes('SECURITY DEFINER'));
  for (const name of rpcNames) {
    assert.match(migration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(migration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});
