import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const main = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const coreRouter = fs.readFileSync(new URL('../src/core-router.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/product-image-treatment-worker.jsx', import.meta.url), 'utf8');
const version = fs.readFileSync(new URL('../src/product-image-processor-version.js', import.meta.url), 'utf8');

test('product image upload sends the same processor version required by the API', () => {
  assert.match(version, /PRODUCT_IMAGE_PROCESSOR_VERSION\s*=\s*'\d+'/);
  assert.match(main, /import \{ PRODUCT_IMAGE_PROCESSOR_VERSION \} from '\.\/product-image-processor-version\.js'/);
  assert.match(main, /fd\.append\('processor_version', PRODUCT_IMAGE_PROCESSOR_VERSION\)/);
  assert.match(coreRouter, /import \{ PRODUCT_IMAGE_PROCESSOR_VERSION \} from '\.\/product-image-processor-version\.js'/);
  assert.match(worker, /import \{ PRODUCT_IMAGE_PROCESSOR_VERSION \} from '\.\/product-image-processor-version\.js'/);
});

test('processor version is not duplicated as a hardcoded contract', () => {
  assert.doesNotMatch(coreRouter, /const PRODUCT_IMAGE_PROCESSOR_VERSION\s*=/);
  assert.doesNotMatch(worker, /const PRODUCT_IMAGE_PROCESSOR_VERSION\s*=/);
  assert.match(worker, /nisti_product_image_treatment_lock_v\$\{PRODUCT_IMAGE_PROCESSOR_VERSION\}/);
});
