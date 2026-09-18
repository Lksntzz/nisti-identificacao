import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicSource = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');
const entrySource = fs.readFileSync(new URL('../src/entry.jsx', import.meta.url), 'utf8');
const scannerSource = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');

test('public application uses the embedded EAN scanner as its primary panel', () => {
  const primaryApp = publicSource.slice(publicSource.indexOf('function PublicIdentificationApp()'));

  assert.match(primaryApp, /<GtinScannerOverlay embedded \/>/);
  assert.doesNotMatch(primaryApp, /type="file"/);
  assert.doesNotMatch(primaryApp, /recognition-platform/);
  assert.match(publicSource, /export default PublicIdentificationApp/);
});

test('entry does not mount a second floating EAN scanner', () => {
  assert.doesNotMatch(entrySource, /gtin-scanner-overlay/);
  assert.doesNotMatch(entrySource, /<GtinScannerOverlay/);
});

test('embedded scanner keeps camera and manual EAN workflows', () => {
  assert.match(scannerSource, /facingMode: \{ ideal: 'environment' \}/);
  assert.match(scannerSource, /Leitor físico ou digitação manual/);
  assert.match(scannerSource, /\/api\/gtin\/\$\{encodeURIComponent\(gtin\)\}/);
  assert.match(scannerSource, /gtin-camera-start/);
});
