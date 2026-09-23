import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicSource = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');
const entrySource = fs.readFileSync(new URL('../src/entry.jsx', import.meta.url), 'utf8');
const scannerSource = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const scannerStyles = fs.readFileSync(new URL('../src/gtin-scanner.css', import.meta.url), 'utf8');

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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicSource = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');
const entrySource = fs.readFileSync(new URL('../src/entry.jsx', import.meta.url), 'utf8');
const scannerSource = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const scannerStyles = fs.readFileSync(new URL('../src/gtin-scanner.css', import.meta.url), 'utf8');

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

test('embedded scanner attempts to open the camera as soon as the application loads', () => {
  assert.match(scannerSource, /if \(!embedded \|\| autoStartAttemptedRef\.current\) return/);
  assert.match(scannerSource, /autoStartAttemptedRef\.current = true;\s+startCamera\(\);/);
  assert.doesNotMatch(scannerSource, /navigator\.permissions\?\.query/);
  assert.doesNotMatch(scannerSource, /CAMERA_ACCESS_STORAGE_KEY/);
});

test('EAN result highlights product finishes without an animated camera overlay', () => {
  assert.match(scannerSource, /\['Wire-o', product\.wireo/);
  assert.match(scannerSource, /\['Tassel', product\.tassel/);
  assert.match(scannerSource, /\['Elástico', product\.elastico/);
  assert.doesNotMatch(scannerSource, /gtin-camera-scan-beam/);
  assert.doesNotMatch(scannerStyles, /@keyframes gtin-scan-beam/);
  assert.match(scannerStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(scannerStyles, /\.gtin-scanner-result[\s\S]*?animation: gtin-result-in/);
});
test('embedded scanner keeps camera and manual EAN workflows', () => {
  assert.match(scannerSource, /facingMode: \{ ideal: 'environment' \}/);
  assert.match(scannerSource, /Leitor físico ou digitação manual/);
  assert.match(scannerSource, /\/api\/gtin\/\$\{encodeURIComponent\(gtin\)\}/);
  assert.match(scannerSource, /gtin-camera-start/);
});

test('embedded scanner attempts to open the camera as soon as the application loads', () => {
  assert.match(scannerSource, /if \(!embedded \|\| autoStartAttemptedRef\.current\) return/);
  assert.match(scannerSource, /autoStartAttemptedRef\.current = true;\s+startCamera\(\);/);
  assert.doesNotMatch(scannerSource, /navigator\.permissions\?\.query/);
  assert.doesNotMatch(scannerSource, /CAMERA_ACCESS_STORAGE_KEY/);
});

test('EAN result highlights product finishes and scanner motion remains accessible', () => {
  assert.match(scannerSource, /\['Wire-o', product\.wireo/);
  assert.match(scannerSource, /\['Tassel', product\.tassel/);
  assert.match(scannerSource, /\['Elástico', product\.elastico/);
  assert.match(scannerSource, /cameraActive && <span className="gtin-camera-scan-beam"/);
  assert.match(scannerStyles, /@keyframes gtin-scan-beam/);
  assert.match(scannerStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(scannerStyles, /\.gtin-scanner-result[\s\S]*?animation: gtin-result-in/);
});
