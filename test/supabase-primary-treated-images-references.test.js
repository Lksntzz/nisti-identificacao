import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const core=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
const mirror=fs.readFileSync(new URL('../src/supabase-mutation-mirror.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261001214000_primary_treated_images_references_v1.sql',import.meta.url),'utf8');

test('treated images and extra references use direct Supabase RPCs',()=>{
  for(const name of ['nisti_set_product_treatment_v1','nisti_prepare_extra_reference_v1',
    'nisti_delete_extra_reference_v1','nisti_list_cover_references_v1']) assert.ok(core.includes(name)||sql.includes(name));
  assert.ok(mirror.includes('product-image-treatment'));
  assert.ok(mirror.includes('cover-references'));
});
test('new image RPCs remain invoker-only and service-role-only',()=>{
  assert.ok(!sql.includes('SECURITY DEFINER'));
  for(const name of ['nisti_set_product_treatment_v1','nisti_list_cover_references_v1',
    'nisti_prepare_extra_reference_v1','nisti_delete_extra_reference_v1']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});
