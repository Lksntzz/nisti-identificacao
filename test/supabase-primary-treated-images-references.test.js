import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
const mirror=fs.readFileSync(new URL('../src/supabase-mutation-mirror.js',import.meta.url),'utf8');
const cleanup=fs.readFileSync(new URL('../supabase/migrations/20261002115500_remove_ai_recognition_legacy.sql',import.meta.url),'utf8');
const masks=fs.readFileSync(new URL('../supabase/migrations/20261002162500_persistent_product_masks_v1.sql',import.meta.url),'utf8');

test('treated images keep direct Supabase RPCs without visual-reference APIs',()=>{
  assert.ok(core.includes('nisti_set_product_treatment_v2'));
  assert.ok(mirror.includes('product-image-treatment'));
  assert.doesNotMatch(core,/cover-references|nisti_prepare_extra_reference_v1|nisti_list_cover_references_v1/);
  assert.doesNotMatch(mirror,/cover-references|mirrorVisualReference/);
});

test('cleanup migration preserves treated-image storage and removes visual-reference storage',()=>{
  assert.match(cleanup,/DROP TABLE IF EXISTS public\.cover_visual_references/);
  assert.doesNotMatch(cleanup,/DROP TABLE IF EXISTS public\.mural_product_images/);
});


test('treated-image persistence includes a product-specific mask without restoring AI references',()=>{
  assert.match(masks,/mask_image_key text/);
  assert.match(masks,/nisti_set_product_mask_v1/);
  assert.match(masks,/nisti_product_mask_queue_v1/);
  assert.doesNotMatch(masks,/cover_visual_references|embedding|vectorize|gemini/i);
});
