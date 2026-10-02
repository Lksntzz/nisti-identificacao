import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mural=fs.readFileSync('src/mural-router.js','utf8');
const mirror=fs.readFileSync('src/supabase-mutation-mirror.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261001245000_primary_mural_residual_v2.sql','utf8');

test('residual Mural admin reads and writes have direct Supabase-primary RPCs',()=>{
  for(const name of [
    'nisti_clear_product_treatment_v1',
    'nisti_admin_mural_products_v1',
    'nisti_admin_mural_metrics_v1',
    'nisti_admin_mural_readiness_v1',
    'nisti_admin_mural_product_reference_v1',
    'nisti_admin_mural_collection_reference_v1'
  ]){
    assert.ok(sql.includes(name),`missing migration RPC ${name}`);
  }
  for(const name of [
    'nisti_admin_mural_post_write_v1',
    'nisti_admin_mural_editorial_image_v1',
    'nisti_set_product_treatment_v1',
    'nisti_clear_product_treatment_v1',
    'nisti_admin_mural_products_v1',
    'nisti_admin_mural_metrics_v1',
    'nisti_admin_mural_readiness_v1'
  ]){
    assert.ok(mural.includes(name),`missing Mural primary route ${name}`);
  }
});

test('Mural residual RPCs remain invoker-only and service-role-only',()=>{
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
  for(const name of [
    'nisti_clear_product_treatment_v1',
    'nisti_admin_mural_products_v1',
    'nisti_admin_mural_metrics_v1',
    'nisti_admin_mural_readiness_v1',
    'nisti_admin_mural_product_reference_v1',
    'nisti_admin_mural_collection_reference_v1'
  ]){
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});

test('Mural image and delete routes are treated as direct primary mutations',()=>{
  assert.ok(mirror.includes("['PUT','DELETE'].includes(method)"));
  assert.ok(mirror.includes("mural\\/posts\\/\\d+\\/image"));
  assert.ok(mirror.includes("mural\\/collections\\/\\d+\\/image"));
  assert.ok(mirror.includes("mural\\/products\\/\\d+\\/image"));
});
