import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
const reads=fs.readFileSync(new URL('../src/supabase-read-store.js',import.meta.url),'utf8');
const mirror=fs.readFileSync(new URL('../src/supabase-mutation-mirror.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261001210000_primary_product_images_v1.sql',import.meta.url),'utf8');

test('product image upload and reads use Supabase in primary mode',()=>{
  assert.ok(core.includes('nisti_prepare_product_image_v1'));
  assert.ok(core.includes('nisti_store_reference_embedding_v1'));
  assert.ok(core.includes('supabaseProductImageContext'));
  assert.ok(core.includes('await env.PRODUCT_IMAGES.delete(key).catch(()=>{})'));
  assert.ok(reads.includes("nisti_product_image_context_v1"));
  assert.ok(mirror.includes('/image$/.test(url.pathname)'));
});

test('product image RPCs are invoker-only and service-role-only',()=>{
  assert.ok(!sql.includes('SECURITY DEFINER'));
  for(const name of ['nisti_prepare_product_image_v1','nisti_store_reference_embedding_v1','nisti_product_image_context_v1']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});
