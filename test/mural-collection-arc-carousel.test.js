import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('published collections open with a product-only cinematic reveal before the card', () => {
  assert.ok(mural.includes('function CollectionRevealIntro'));
  assert.ok(mural.includes('products={products}'));
  assert.ok(mural.includes('mural-collection-reveal-white-arc'));
  assert.ok(mural.includes('mural-collection-reveal-product'));
  assert.ok(mural.includes('CollectionProductImage product={product}'));
  assert.ok(mural.includes('const showIntro = Boolean(collection && products.length && !introComplete)'));
});

test('intro shows only transparent product imagery over a white arc and dark screen', () => {
  assert.ok(mural.includes('const mainProduct = products[0]'));
  assert.ok(mural.includes('const secondaryProducts = products.slice(1)'));
  assert.ok(css.includes('background:rgba(0,0,0,.94)'));
  assert.ok(css.includes('.mural-collection-reveal-white-arc'));
  assert.ok(css.includes('background:transparent'));
  assert.equal(mural.includes('mural-collection-arc-caption'), false);
});

test('arc and main cover rise first while every other cover alternates from behind to front', () => {
  assert.ok(css.includes('transform:translate3d(-50%,62vh,0) rotate(0) scale(.62)'));
  assert.ok(css.includes('@keyframes mural-collection-main-float'));
  assert.ok(css.includes('@keyframes mural-collection-cover-arrive'));
  assert.ok(mural.includes('const mainFloatCycles = Math.max(1'));
  assert.ok(css.includes('animation-iteration-count:var(--main-float-cycles,1)'));
  assert.ok(mural.includes("side: side < 0 ? 'left' : 'right'"));
  assert.ok(mural.includes("'--reveal-product-delay': `${1600 + secondaryIndex * 1050}ms`"));
  assert.ok(mural.includes("'--reveal-final-layer': String(10 + index)"));
  assert.ok(css.includes('z-index:3'));
  assert.ok(css.includes('z-index:var(--reveal-final-layer)'));
  assert.ok(css.includes('var(--reveal-peek-x)'));
  assert.equal(mural.includes('products.slice(0, 5)'), false);
});

test('slower intro holds the complete fan before mounting the card', () => {
  assert.ok(mural.includes('1600 + (secondaryCount - 1) * 1050 + 1500'));
  assert.ok(mural.includes('lastCoverFinish + 1200'));
  assert.ok(mural.includes('lastCoverFinish + 1620'));
  assert.ok(css.includes('animation:mural-collection-cover-arrive 1500ms'));
  assert.ok(mural.includes('{!showIntro && ('));
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
});
