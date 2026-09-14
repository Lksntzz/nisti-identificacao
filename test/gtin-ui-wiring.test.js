import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('public UI offers camera and manual GTIN resolution', () => {
  const source = fs.readFileSync('src/public-main.jsx', 'utf8');
  assert.match(source, /BrowserMultiFormatReader/);
  assert.match(source, /facingMode: \{ ideal: 'environment' \}/);
  assert.match(source, /\/api\/gtin\/resolve\?gtin=/);
  assert.match(source, /Digite os 13 números/);
  assert.match(source, /disabled=\{!platform \|\| busy\}/);
});
