import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const scannerSource = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');
const scannerStyles = fs.readFileSync(new URL('../src/gtin-scanner.css', import.meta.url), 'utf8');

test('EAN result uses compact product metadata instead of tall cards', () => {
  assert.match(scannerSource, /gtin-result-details/);
  assert.match(scannerSource, /gtin-result-detail/);
  assert.match(scannerStyles, /\.gtin-result-detail \{/);
  assert.match(scannerStyles, /border-bottom: 1px solid #eef2f7/);
  assert.doesNotMatch(scannerStyles, /\.gtin-result-detail \{[^}]*border-radius:/s);
});

test('EAN scanner keeps a bounded recent result history on the device', () => {
  assert.match(scannerSource, /GTIN_HISTORY_STORAGE_KEY = 'nisti_gtin_scan_history_v1'/);
  assert.match(scannerSource, /GTIN_HISTORY_LIMIT = 20/);
  assert.match(scannerSource, /localStorage\.setItem\(GTIN_HISTORY_STORAGE_KEY/);
  assert.match(scannerSource, /Histórico de resultados/);
  assert.match(scannerSource, /recordHistory: false/);
  assert.match(scannerSource, /Limpar o histórico de EAN deste aparelho\?/);
});
