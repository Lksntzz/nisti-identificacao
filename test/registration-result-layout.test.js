import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');

test('registration result keeps barcode cards inside the create-product modal', () => {
  assert.match(app, /className="registration-result"/);
  assert.match(app, /className="registration-barcode-card"/);
  assert.match(app, /className="registration-barcode-preview"/);
  assert.match(css, /\.admin-modal\.create-modal\s*\{[\s\S]*?width:\s*min\(820px,\s*100%\)/);
  assert.match(css, /\.registration-barcode-card\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(css, /\.registration-barcode-preview svg\s*\{[\s\S]*?width:\s*100%/);
  assert.match(css, /\.registration-result-actions\s*\{[\s\S]*?position:\s*sticky/);
});

test('registration result has a single-column mobile fallback', () => {
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?\.registration-barcode-card\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
  assert.match(css, /@media \(max-width:\s*760px\)[\s\S]*?\.registration-result-actions > button\s*\{[\s\S]*?width:\s*100%/);
});
