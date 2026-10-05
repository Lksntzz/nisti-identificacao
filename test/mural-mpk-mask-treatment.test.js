import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { __muralMpkMaskInternals } from '../src/mural-mpk-mask-treatment.js';

const source = fs.readFileSync(new URL('../src/mural-mpk-mask-treatment.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/product-image-treatment-worker.jsx', import.meta.url), 'utf8');

test('MPK v22 uses only the two official Photoshop geometry profiles', () => {
  assert.equal(__muralMpkMaskInternals.REFERENCE_SIZE, 1200);
  assert.equal(__muralMpkMaskInternals.resolveMpkProfile({ kind:'horizontal', metrics:{ aspect:1.3 } }), 'horizontal_v1');
  assert.equal(__muralMpkMaskInternals.resolveMpkProfile({ kind:'standard', metrics:{ aspect:.72 } }), 'vertical_v1');
  assert.equal(__muralMpkMaskInternals.resolveMpkProfile({ kind:'perspective', metrics:{ aspect:.8 } }), 'vertical_v1');
  assert.equal(__muralMpkMaskInternals.resolveMpkProfile({ kind:'disc', metrics:{ aspect:1.2 } }), 'horizontal_v1');
  assert.equal(__muralMpkMaskInternals.resolveMpkProfile({ kind:'disc', metrics:{ aspect:.75 } }), 'vertical_v1');
});

test('MPK v22 respects SKU accessory X rules', () => {
  assert.deepEqual(
    __muralMpkMaskInternals.accessoryFlags({ sku:'VACMNO_TEST_BXX' }),
    { tassel:false, elastic:false }
  );
  assert.deepEqual(
    __muralMpkMaskInternals.accessoryFlags({ sku:'VACMNO_TEST_BRB' }),
    { tassel:true, elastic:true }
  );
});

test('MPK treatment is deterministic and does not reintroduce heuristic segmentation or external AI', () => {
  assert.match(source, /MKP FRENTE ATUAL copiar 2\.psd/);
  assert.match(source, /MOCKUP HORIZONTAL\(1\)\.psd/);
  assert.match(source, /new Path2D/);
  assert.doesNotMatch(source, /grabcut|opencv|gemini|workers ai|flood.?fill/i);
  assert.doesNotMatch(source, /https?:\/\//);
});

test('manual treatment queue uses MPK artifacts and MPK mask backfill', () => {
  assert.match(worker, /mpkProductImageTreatmentArtifactsBlob/);
  assert.match(worker, /mpkProductImageMaskBlob/);
  assert.doesNotMatch(worker, /productImageTreatmentArtifactsBlob/);
  assert.doesNotMatch(worker, /productImageMaskBlob/);
});
