import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration=fs.readFileSync(new URL('../migrations/0020_mural_product_images.sql',import.meta.url),'utf8');
const reprocessMigration=fs.readFileSync(new URL('../migrations/0021_mural_product_images_reprocess.sql',import.meta.url),'utf8');
const core=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const publicImages=fs.readFileSync(new URL('../src/public-image-router.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const deploy=fs.readFileSync(new URL('../.github/workflows/deploy-production.yml',import.meta.url),'utf8');

test('Mural stores product derivatives separately without overwriting catalog originals',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS mural_product_images/);
  assert.match(migration,/source_image_key TEXT NOT NULL/);
  assert.match(migration,/processed_image_key TEXT/);
  assert.match(migration,/status IN \('pending','review','approved','failed','stale'\)/);
  assert.doesNotMatch(migration,/ALTER TABLE products ADD COLUMN/);
});

test('changing a catalog image invalidates its Mural derivative',()=>{
  assert.match(core,/INSERT INTO mural_product_images/);
  assert.match(core,/processed_image_key=NULL/);
  assert.match(core,/status='pending'/);
  assert.match(core,/PRODUCT_IMAGES\.delete\(product\.mural_processed_image_key\)/);
});

test('public Mural serves only approved derivatives matching the current source image',()=>{
  assert.match(publicImages,/mpi\.status='approved'/);
  assert.match(publicImages,/mpi\.source_image_key=p\.image_key/);
  assert.match(publicImages,/api\\\/mural-product-images/);
  assert.match(router,/mural_image_status !== 'approved'/);
  assert.match(router,/mural_source_image_key !== row\?\.image_key/);
});

test('admin accepts transparent PNG derivatives and preserves the original image',()=>{
  assert.match(router,/inspectTransparentPng/);
  assert.match(router,/\[4,6\]\.includes\(colorType\)/);
  assert.match(router,/mural\/products\/\$\{productId\}/);
  assert.match(admin,/Imagens dos produtos/);
  assert.match(admin,/A foto original do catálogo fica intacta/);
  assert.match(admin,/original_image_url/);
});

test('production applies D1 migrations before deploying the new Worker',()=>{
  const migrate=deploy.indexOf('d1 migrations apply nisti-identificacao --remote');
  const publish=deploy.indexOf('npx wrangler deploy');
  assert.ok(migrate>0);
  assert.ok(publish>migrate);
});


test('global reprocess migration covers every database product while preserving approved manual PNGs',()=>{
  assert.match(reprocessMigration,/FROM products p/);
  assert.match(reprocessMigration,/WHERE p\.image_key IS NOT NULL/);
  assert.match(reprocessMigration,/ON CONFLICT\(product_id\) DO UPDATE SET/);
  assert.match(reprocessMigration,/mural_product_images\.processor = 'admin-upload'/);
  assert.match(reprocessMigration,/THEN 'approved'/);
  assert.match(reprocessMigration,/ELSE 'pending'/);
  assert.match(reprocessMigration,/SELECT id FROM products WHERE image_key IS NULL/);
  assert.match(reprocessMigration,/status = 'stale'/);
});
