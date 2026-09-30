import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const muralCss = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const publicMain = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');
const appCss = fs.readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');

test('part 8 uses consistent SVG icons for tabs, notices and card actions', () => {
  assert.ok(mural.includes('function MuralIcon'));
  for (const name of ['package', 'layers', 'megaphone', 'chevron', 'star']) {
    assert.ok(mural.includes(`name === '${name}'`) || mural.includes(`name="${name}"`));
  }
  assert.ok(mural.includes("const names = { all: 'sparkles', products: 'package', collections: 'layers', notices: 'megaphone' }"));
});

test('part 8 hero has editorial scene, featured/new badges and mural decoration', () => {
  assert.ok(mural.includes('mural-hero-editorial'));
  assert.ok(mural.includes('mural-hero-featured-badge'));
  assert.ok(mural.includes('mural-hero-new-badge'));
  assert.ok(mural.includes('mural-title-accent'));
  assert.ok(muralCss.includes('.mural-scene-plant'));
  assert.ok(muralCss.includes('.mural-scene-books'));
  assert.ok(muralCss.includes('.mural-scene-pen'));
});

test('part 8 feed cards match compact product collection and notice hierarchy', () => {
  assert.ok(mural.includes('mural-card-reference'));
  assert.ok(mural.includes('mural-card-new-pill'));
  assert.ok(mural.includes('mural-card-notice-pill'));
  assert.ok(mural.includes('mural-card-reference-meta'));
  assert.ok(muralCss.includes('.mural-card-reference.mural-card-collection'));
  assert.ok(muralCss.includes('.mural-notice-visual'));
});

test('part 8 Mural header uses Mural identity and keeps Scanner return on the brand', () => {
  assert.ok(publicMain.includes("inMural ? 'Mural NISTI' : 'Scanner de EAN'"));
  assert.ok(publicMain.includes('className="brand-identity brand-identity-button"'));
  assert.ok(publicMain.includes('aria-label="Voltar ao Scanner"'));
  assert.ok(appCss.includes('.mural-viewport .brand-main-title'));
  assert.ok(appCss.includes('.mural-viewport .brand-subtext'));
});

test('part 8 preserves the public release gate', () => {
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(publicMain.includes('<h2>Em breve</h2>'));
});
