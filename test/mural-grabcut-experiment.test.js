import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('GrabCut experiment is explicit-only and pinned to one OpenCV build', () => {
  const grabcut = read('src/mural-grabcut.js');
  const worker = read('src/product-image-treatment-worker.jsx');
  const admin = read('src/admin/MuralNistiAdminView.jsx');

  assert.match(grabcut, /https:\/\/docs\.opencv\.org\/4\.13\.0\/opencv\.js/);
  assert.match(grabcut, /cv\.grabCut\(rgb, grabMask, rect, bgdModel, fgdModel, 5, cv\.GC_INIT_WITH_RECT\)/);
  assert.match(grabcut, /Nenhuma imagem foi salva/);
  assert.match(grabcut, /rgba\?\.delete\(\)/);
  assert.match(grabcut, /grabMask\?\.delete\(\)/);
  assert.equal(worker.includes('mural-grabcut'), false);
  assert.match(admin, /Testar novo recorte/);
});

test('GrabCut experiment keeps the old queue isolated until validation', () => {
  const admin = read('src/admin/MuralNistiAdminView.jsx');
  const worker = read('src/product-image-treatment-worker.jsx');

  assert.match(admin, /grabCutProductArtifacts/);
  assert.match(admin, /processor_version/);
  assert.equal(worker.includes('grabCutProductArtifacts'), false);
});
