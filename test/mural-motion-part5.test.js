import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const experience = fs.readFileSync(new URL('../src/mural-product-experience.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const publicMain = fs.readFileSync(new URL('../src/public-main.jsx', import.meta.url), 'utf8');

test('part 7 supersedes the old single-image WebGL viewer', () => {
  assert.equal(experience.includes("getContext('webgl'"), false);
  assert.equal(experience.includes('activeStepRef'), false);
  assert.ok(experience.includes('mural-product-focus-stage'));
  assert.ok(experience.includes('mural-product-focus-panel'));
});

test('product focus exposes four explicit editorial views', () => {
  for (const label of ['Visão', 'Identificação', 'Acabamentos', 'Editorial']) {
    assert.ok(experience.includes(label));
  }
  assert.ok(experience.includes('role="tab"'));
  assert.ok(experience.includes('aria-selected={activeFocus === index}'));
});

test('product focus uses honest static media with resilient fallback', () => {
  assert.ok(experience.includes('function ProductVisual'));
  assert.ok(experience.includes('Imagem do produto indisponível'));
  assert.ok(experience.includes('onError={() => setFailed(true)}'));
  assert.ok(css.includes('.mural-product-focus-image'));
});

test('product focus respects reduced motion', () => {
  assert.ok(css.includes('.mural-product-focus-glow,'));
  assert.ok(css.includes('transition:none!important'));
});

test('public Em breve gate remains closed', () => {
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
  assert.ok(publicMain.includes('<h2>Em breve</h2>'));
});
