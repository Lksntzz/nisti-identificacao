import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scannerSource = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const scannerStyles = fs.readFileSync(new URL('../src/gtin-scanner.css', import.meta.url), 'utf8');

test('EAN result uses compact professional cards for product metadata', () => {
  assert.match(scannerSource, /gtin-result-details/);
  assert.match(scannerSource, /gtin-result-detail/);
  assert.match(scannerStyles, /\.gtin-result-detail \{/);
  assert.match(scannerStyles, /grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/);
  assert.match(scannerStyles, /border-radius: 11px/);
  assert.match(scannerStyles, /background: #fbfdff/);
});

test('EAN scanner keeps a bounded recent result history on the device', () => {
  assert.match(scannerSource, /GTIN_HISTORY_STORAGE_KEY = 'nisti_gtin_scan_history_v1'/);
  assert.match(scannerSource, /GTIN_HISTORY_LIMIT = 20/);
  assert.match(scannerSource, /localStorage\.setItem\(GTIN_HISTORY_STORAGE_KEY/);
  assert.match(scannerSource, /Histórico de resultados/);
  assert.match(scannerSource, /Limpar o histórico de EAN deste aparelho\?/);
  assert.match(scannerSource, /createPortal/);
  assert.match(scannerSource, /gtin-history-modal-backdrop/);
  assert.match(scannerSource, /hasTasselLabel/);
  assert.match(scannerSource, /item\.product\.elastico/);
  assert.match(scannerSource, /item\.product\.wireo/);
  assert.doesNotMatch(scannerSource, /gtin-history-time/);
});


test('local EAN history opens in a floating modal without expanding the scanner page', () => {
  assert.match(scannerSource, /const \[historyOpen, setHistoryOpen\]/);
  assert.match(scannerSource, /aria-haspopup="dialog"/);
  assert.match(scannerSource, /role="dialog"/);
  assert.match(scannerSource, /aria-modal="true"/);
  assert.match(scannerStyles, /\.gtin-history-modal-backdrop \{/);
  assert.match(scannerStyles, /position: fixed/);
  assert.match(scannerStyles, /background: rgba\(15, 23, 42, 0\.52\)/);
  assert.match(scannerStyles, /body\.gtin-history-modal-open/);
});

test('history modal shows only image, SKU, tassel presence, elastic and wire-o data', () => {
  const modalStart = scannerSource.indexOf('function GtinHistoryModal');
  const modalEnd = scannerSource.indexOf('export default function GtinScannerOverlay');
  const modal = scannerSource.slice(modalStart, modalEnd);

  assert.match(modal, /image_url/);
  assert.match(modal, />SKU</);
  assert.match(modal, />Tassel</);
  assert.match(modal, />Elástico</);
  assert.match(modal, />Wire-o</);
  assert.doesNotMatch(modal, /EAN \{item\.gtin\}/);
  assert.doesNotMatch(modal, /formatHistoryTimestamp/);
  assert.doesNotMatch(modal, /item\.product\.nome/);
});


test('approved scanner layout keeps instructions inside the camera and result in a separate card', () => {
  assert.match(scannerSource, /gtin-scanner-instructions-icon/);
  assert.match(scannerSource, /gtin-result-status-left/);
  assert.match(scannerSource, /gtin-result-status-ean/);
  assert.match(scannerStyles, /\.gtin-camera-shell \.gtin-scanner-instructions/);
  assert.match(scannerStyles, /position: absolute/);
  assert.match(scannerStyles, /\.gtin-scanner-panel\.embedded > \.gtin-scanner-header/);
});
