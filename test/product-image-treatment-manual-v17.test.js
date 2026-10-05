import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('treated image v18 is manual-only from UI to worker', () => {
  const main = read('src/main.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');
  const admin = read('src/admin/MuralNistiAdminView.jsx');

  assert.equal(main.includes('TREATMENT_WAKE_EVENT'), false);
  assert.equal(worker.includes('TREATMENT_WAKE_EVENT'), false);
  assert.equal(worker.includes('IDLE_POLL_MS'), false);
  assert.equal(worker.includes('const timer = window.setTimeout(run, 900)'), false);
  assert.ok(worker.includes("return localStorage.getItem(TREATMENT_PAUSE_KEY) !== '0'"));
  assert.ok(worker.includes('TREATMENT_CONTROL_EVENT'));
  assert.ok(admin.includes('Tratamento manual'));
  assert.ok(admin.includes('Aguardando início manual'));
});

test('rendering never manufactures a treated derivative in the browser', () => {
  const utility = read('src/mural-transparent-image.js');
  const start = utility.indexOf('export function useTreatedProductImage');
  const end = utility.indexOf('export const __muralTransparentImageInternals');
  const hook = utility.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(hook.includes('Display is server-authoritative'));
  assert.equal(hook.includes('treatedProductImageUrl('), false);
  assert.equal(hook.includes('buildTreatedProductImage('), false);
});

test('API rejects stale treatment writes but keeps previously approved derivatives valid', () => {
  const core = read('src/core-router.js');
  const publicImages = read('src/public-image-router.js');
  const mural = read('src/mural-router.js');
  const version = read('src/product-image-processor-version.js');

  assert.ok(version.includes("PRODUCT_IMAGE_PROCESSOR_VERSION = '24'"));
  assert.ok((core.match(/code:'stale_image_processor'/g) || []).length >= 2);
  assert.equal(core.includes('row.processor_version === PRODUCT_IMAGE_PROCESSOR_VERSION'), false);
  assert.equal(core.includes('product.treated_image_version === PRODUCT_IMAGE_PROCESSOR_VERSION'), false);
  assert.equal(publicImages.includes('PRODUCT_IMAGE_PROCESSOR_VERSION'), false);
  assert.equal(publicImages.includes('mpi.processor_version=?'), false);
  assert.equal(mural.includes('row?.mural_image_processor_version !== PRODUCT_IMAGE_PROCESSOR_VERSION'), false);
});
test('database migration invalidates pre-v18 derivatives without deleting originals', () => {
  const supabase = read('supabase/migrations/20261002213000_per_product_cutout_v18.sql');
  const d1 = read('migrations/0026_per_product_cutout_v18.sql');

  for (const migration of [supabase, d1]) {
    assert.match(migration, /status='pending'/);
    assert.match(migration, /COALESCE\(processor_version,''\) <> '18'/);
    assert.doesNotMatch(migration, /DELETE FROM products|UPDATE products SET image_key/i);
  }
  assert.match(supabase, /processor_version='18'/);
  assert.match(supabase, /reviewed_by='admin'/);
  assert.match(supabase, /status='review'/);
  assert.match(supabase, /processor_version=p_processor_version/);
});


test('processor upgrades never reopen an explicitly approved product', () => {
  const migration = read('supabase/migrations/20261002215500_preserve_approved_treatment_state.sql');
  assert.match(migration, /mpi\.status='approved'/);
  assert.match(migration, /mpi\.reviewed_by='admin'/);
  assert.match(migration, /mpi\.source_image_key=p\.image_key/);
  assert.doesNotMatch(migration, /processor_version='18'/);
  assert.doesNotMatch(migration, /UPDATE public\.mural_product_images[\s\S]{0,180}status='pending'/i);
});
