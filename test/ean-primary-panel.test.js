import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const publicSource = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');
const entrySource = fs.readFileSync(new URL('../src/entry.jsx', import.meta.url), 'utf8');
const scannerSource = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const scannerStyles = fs.readFileSync(new URL('../src/gtin-scanner.css', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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
  assert.match(scannerSource, /label: 'Wire-o', value: product\.wireo/);
  assert.match(scannerSource, /label: 'Tassel', value: product\.tassel/);
  assert.match(scannerSource, /label: 'Elástico', value: product\.elastico/);
  assert.doesNotMatch(scannerSource, /gtin-camera-scan-beam/);
  assert.doesNotMatch(scannerSource, /gtin-laser-dynamic/);
  assert.doesNotMatch(scannerStyles, /@keyframes gtin-scan-beam/);
  assert.doesNotMatch(scannerStyles, /@keyframes gtin-laser-traverse/);
  assert.match(scannerStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(scannerStyles, /\.gtin-scanner-result[\s\S]*?animation: gtin-result-in/);
});


test('scanner shows product type instead of the full product name', () => {
  assert.match(scannerSource, /function productTypeLabel\(product\)/);
  assert.match(scannerSource, /\[\/\\bplanner\\b\/, 'Planner'\]/);
  assert.match(scannerSource, /\[\/\\bagenda\\b\/, 'Agenda'\]/);
  assert.match(scannerSource, /\[\/\\bcaderno\\b\|\\bnotebook\\b\/, 'Caderno'\]/);
  assert.match(scannerSource, /<h3>\{productType\}<\/h3>/);
  assert.doesNotMatch(scannerSource, /<h3>\{product\.nome \|\| product\.sku\}<\/h3>/);
});

test('scanner result uses icons for cover, variation, wire-o, tassel and elastic', () => {
  assert.match(scannerSource, /function ProductDetailIcon/);
  assert.match(scannerSource, /icon: 'cover'/);
  assert.match(scannerSource, /icon: 'variation'/);
  assert.match(scannerSource, /icon: 'wireo'/);
  assert.match(scannerSource, /icon: 'tassel'/);
  assert.match(scannerSource, /icon: 'elastic'/);
  assert.match(scannerSource, /gtin-result-detail-icon/);
});


test('mobile scanner disables page zoom and keeps the scanner viewport fixed', () => {
  assert.match(indexSource, /maximum-scale=1\.0,user-scalable=no/);
  assert.match(scannerSource, /gtin-fixed-viewport/);
  assert.match(scannerSource, /gesturestart/);
  assert.match(scannerSource, /touches\.length > 1/);
  assert.match(scannerStyles, /Scanner mobile fixo: sem scroll da tela/);
  assert.match(scannerStyles, /overflow: hidden !important/);
  assert.match(scannerStyles, /max-height: 32dvh/);
});

test('mobile fixed scanner keeps manual input readable without iOS focus zoom', () => {
  assert.match(scannerStyles, /\.gtin-manual-row input \{[\s\S]*?font-size: 16px;/);
  assert.match(scannerStyles, /@media \(max-width: 640px\) and \(max-height: 700px\)/);
});


test('scanner gives visual priority to wire-o, tassel and elastic', () => {
  assert.match(scannerSource, /label: 'Wire-o'[\s\S]*priority: 'primary'/);
  assert.match(scannerSource, /label: 'Tassel'[\s\S]*priority: 'primary'/);
  assert.match(scannerSource, /label: 'Elástico'[\s\S]*priority: 'primary'/);
  assert.match(scannerSource, /is-priority/);
  assert.match(scannerStyles, /\.gtin-result-detail\.is-priority/);
  assert.match(scannerStyles, /font-size: 11\.5px/);
});
