import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('GTIN camera prefers BarcodeDetector and keeps ZXing fallback', () => {
  const source = fs.readFileSync('src/gtin-camera.js', 'utf8');
  assert.match(source, /globalThis\?\.BarcodeDetector/);
  assert.match(source, /formats: \['ean_13'\]/);
  assert.match(source, /detector\.detect\(videoElement\)/);
  assert.match(source, /detector\.detect\(bitmap\)/);
  assert.match(source, /new BrowserMultiFormatReader\(\)/);
  assert.match(source, /decodeFromConstraints/);
  assert.match(source, /decodeFromImageElement/);
});

test('GTIN camera accepts only checksum-valid GTIN-13 values', () => {
  const source = fs.readFileSync('src/gtin-camera.js', 'utf8');
  assert.match(source, /isValidGtin13\(normalized\)/);
  assert.match(source, /acceptedGtin\(barcode\?\.rawValue\)/);
  assert.match(source, /acceptedGtin\(result\?\.getText\?\.\(\)\)/);
});
