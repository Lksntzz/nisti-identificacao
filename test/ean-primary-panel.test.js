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

test('public EAN scanner does not expose an administrative shortcut', () => {
  assert.doesNotMatch(publicSource, /Painel Admin/);
  assert.doesNotMatch(publicSource, /navigateToAdmin/);
  assert.doesNotMatch(publicSource, /Abrir Painel Administrativo/);
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

test('continuous EAN reading keeps the camera mounted and blocks duplicate scans', () => {
  assert.match(scannerSource, /const SAME_EAN_RELEASE_MS = 1800/);
  assert.match(scannerSource, /acceptedGtinRef\.current = \{ value: gtin, lastSeenAt: Date\.now\(\) \}/);
  assert.match(scannerSource, /if \(accepted\.value === value\)/);
  assert.match(scannerSource, /Date\.now\(\) - accepted\.lastSeenAt >= SAME_EAN_RELEASE_MS/);
  assert.match(scannerSource, /<video ref=\{videoRef\}[\s\S]*?\{product && \(/);
  assert.doesNotMatch(scannerSource, /\{!product && \(/);
  assert.doesNotMatch(scannerSource, /pauseCameraScan/);
  assert.doesNotMatch(scannerSource, /Ler outro EAN/);
});

test('continuous scanner can be paused without stopping the camera stream', () => {
  assert.match(scannerSource, /const \[scannerPaused, setScannerPaused\] = useState\(false\)/);
  assert.match(scannerSource, /activeRef\.current = false;\s+if \(animationRef\.current\) cancelAnimationFrame/);
  assert.match(scannerSource, /scannerPaused \? 'Continuar leitura' : 'Pausar leitura'/);
  assert.match(scannerStyles, /\.gtin-camera-pause/);
  assert.match(scannerStyles, /\.gtin-scanner-result\.is-continuous/);
});

test('EAN result highlights product finishes without an animated camera overlay', () => {
  assert.match(scannerSource, /\['Wire-o', product\.wireo/);
  assert.match(scannerSource, /\['Tassel', product\.tassel/);
  assert.match(scannerSource, /\['Elástico', product\.elastico/);
  assert.doesNotMatch(scannerSource, /gtin-camera-scan-beam/);
  assert.doesNotMatch(scannerSource, /gtin-laser-dynamic/);
  assert.doesNotMatch(scannerStyles, /@keyframes gtin-scan-beam/);
  assert.doesNotMatch(scannerStyles, /@keyframes gtin-laser-traverse/);
  assert.match(scannerStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(scannerStyles, /\.gtin-scanner-result[\s\S]*?animation: gtin-result-in/);
});
