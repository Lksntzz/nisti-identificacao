import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  'supabase/migrations/20261001261000_primary_product_delete_commerce_cleanup_v1.sql',
  'utf8'
);

test('product deletion removes the stale NISTI Commerce link in the same Supabase transaction',()=>{
  assert.match(sql,/DELETE FROM public\.commerce_nisti_product_links/);
  assert.match(sql,/WHERE nisti_product_id=p_id/);
  assert.match(sql,/DELETE FROM public\.products/);
  assert.match(sql,/'commerce_link_removed',true/);
});

test('product delete RPC stays invoker-only and service-role-only',()=>{
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
  assert.match(sql,/SECURITY INVOKER/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.nisti_delete_product_primary_v1\(bigint\)/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.nisti_delete_product_primary_v1\(bigint\)/);
});
