import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Mural treatment queue runs heavy processing in a dedicated Worker', () => {
  const queue = read('src/product-image-treatment-worker.jsx');
  const client = read('src/product-image-treatment-background.js');
  const worker = read('src/mural-treatment-background.worker.js');

  assert.match(queue, /backgroundProductImageTreatmentArtifactsBlob/);
  assert.match(queue, /backgroundProductImageMaskBlob/);
  assert.doesNotMatch(queue, /productImageTreatmentArtifactsBlob/);
  assert.doesNotMatch(queue, /productImageMaskBlob/);

  assert.match(client, /new Worker\(/);
  assert.match(client, /worker\.terminate\(\)/);
  assert.match(client, /DEFAULT_TREATMENT_TIMEOUT_MS = 30 \* 1000/);
  assert.match(client, /BACKGROUND_MAX_RENDER_DIMENSION = 1024/);
  assert.match(client, /OffscreenCanvas/);
  assert.doesNotMatch(client, /opencv|grabcut|docs\.opencv/i);

  assert.match(worker, /buildTreatedProductImage/);
  assert.match(worker, /self\.onmessage/);
  assert.match(queue, /preserveExisting/);
  assert.match(queue, /skippedTreatmentIds/);
  assert.doesNotMatch(worker, /https?:\/\//);
});

test('Mural raster engine supports OffscreenCanvas without duplicating the cutout engine', () => {
  const engine = read('src/mural-transparent-image.js');

  assert.match(engine, /function createRasterCanvas\(width, height\)/);
  assert.match(engine, /new OffscreenCanvas\(width, height\)/);
  assert.match(engine, /canvas\.convertToBlob/);
  assert.match(engine, /buildTreatedProductImage/);
});
