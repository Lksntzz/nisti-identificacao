import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public UI offers camera and manual GTIN resolution', () => {
  const source = fs.readFileSync('src/public-main.jsx', 'utf8');
  assert.match(source, /startGtinVideoScanner/);
  assert.match(source, /\/api\/gtin\/resolve\?gtin=/);
  assert.match(source, /Digite os 13 números/);
  assert.match(source, /disabled=\{!platform \|\| busy\}/);
});

test('uploaded camera image attempts GTIN before visual recognition', () => {
  const source = fs.readFileSync('src/public-main.jsx', 'utf8');
  assert.match(source, /const identifyCapturedFile = async/);
  assert.match(source, /const gtin = await detectGtinInImage\(file\)/);
  assert.match(source, /if \(gtin\) \{[\s\S]*await resolveGtin\(gtin, activePlatform\);[\s\S]*return;[\s\S]*\}/);
  assert.match(source, /await identifyFileWithPlatform\(file, activePlatform\)/);
  assert.match(source, /onClick=\{\(\) => identifyFile\(photo\)\}/);
});

test('GTIN result cannot submit barcode image as visual-training error', () => {
  const source = fs.readFileSync('src/public-main.jsx', 'utf8');
  assert.match(source, /const identifiedByGtin = product\.identified_by === 'gtin-gs1-v1'/);
  assert.match(source, /if \(identifiedByGtin \|\| reporting \|\| reported \|\| !photo\) return/);
  assert.match(source, /!identifiedByGtin && \(/);
});
