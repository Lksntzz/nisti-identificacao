import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const publicMain = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');
const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const display = fs.readFileSync(new URL('../src/product-display.js', import.meta.url), 'utf8');

test('phase 2 keeps scanner/mural navigation while public mural is release-gated', () => {
  assert.match(publicMain, /publicView === 'scanner' \? \(/);
  assert.match(publicMain, /<GtinScannerOverlay embedded \/>/);
  assert.match(publicMain, /muralAccess \? \(/);
  assert.match(publicMain, /<MuralNisti onUnreadChange=\{setMuralUnread\} \/>/);
  assert.match(publicMain, /className="mural-coming-soon"/);
  assert.match(publicMain, /<h2>Em breve<\/h2>/);
  assert.match(publicMain, /onOpenScanner=\{\(\) => setPublicView\('scanner'\)\}/);
  assert.match(publicMain, /onOpenMural=\{\(\) => setPublicView\('mural'\)\}/);
});

test('mural exposes all four tabs and marks unread content only when opened', () => {
  for (const value of ['all', 'products', 'collections', 'notices']) {
    assert.ok(mural.includes(`['${value}',`));
  }
  assert.match(mural, /if \(item\.is_read\) return;/);
  assert.match(mural, /\/api\/mural\/\$\{item\.id\}\/read/);
  assert.match(mural, /item\.is_read\) return null/);
});

test('product cards show current operational finish fields', () => {
  assert.match(mural, />Wire-o</);
  assert.match(mural, />Tassel</);
  assert.match(mural, />Elástico</);
  assert.match(mural, /product\.sku/);
  assert.match(mural, /product\.collection/);
});

test('phase 2 provides hero, collection detail and accessible detail dialog', () => {
  assert.match(mural, /function Hero\(/);
  assert.match(mural, /\/api\/mural\/collections\//);
  assert.match(mural, /role="dialog"/);
  assert.match(mural, /aria-modal="true"/);
  assert.match(mural, /event\.key === 'Escape'/);
});

test('mural owns scrolling and responsive rules cover the required mobile widths', () => {
  assert.match(css, /\.mural-scroll\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(min-width: 431px\)/);
  assert.match(css, /width:\s*min\(100%, 720px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test('product type label is shared instead of duplicated in the mural router', () => {
  assert.match(display, /export function productTypeLabel/);
  assert.match(display, /Planner/);
  assert.match(display, /Agenda/);
  assert.match(display, /Caderno/);
});
