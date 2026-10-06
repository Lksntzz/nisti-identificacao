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

test('arc rises before main cover and secondary covers settle in alternating fan layers', () => {
  assert.ok(css.includes('transform:translate3d(-50%,64vh,0) rotate(0) scale(.62)'));
  assert.ok(css.includes('transition-delay:520ms'));
  assert.equal(css.includes('@keyframes mural-collection-main-float'), false);
  assert.ok(css.includes('@keyframes mural-collection-cover-arrive'));
  assert.ok(mural.includes("side: side < 0 ? 'left' : 'right'"));
  assert.ok(mural.includes('layer: String(index % 2'));
  assert.ok(mural.includes("'--reveal-product-delay': `${secondaryStart + secondaryIndex * secondaryStep}ms`"));
  assert.ok(mural.includes("'--reveal-final-layer': position.layer"));
  assert.ok(css.includes('z-index:6'));
  assert.ok(css.includes('z-index:2'));
  assert.ok(css.includes('z-index:var(--reveal-final-layer)'));
  assert.ok(css.includes('var(--reveal-peek-x)'));
  assert.equal(mural.includes('products.slice(0, 5)'), false);
});

test('slower intro holds the complete fan before mounting the card', () => {
  assert.ok(mural.includes('const secondaryStart = 1850'));
  assert.ok(mural.includes('const secondaryStep = 900'));
  assert.ok(mural.includes('const secondaryDuration = 1350'));
  assert.ok(mural.includes('const fanHold = 1100'));
  assert.ok(mural.includes('lastCoverFinish + fanHold'));
  assert.ok(mural.includes('lastCoverFinish + fanHold + fadeDuration'));
  assert.ok(css.includes('animation:mural-collection-cover-arrive 1350ms'));
  assert.ok(mural.includes('{!showIntro && ('));
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
});


test('white arc is clean and secondary covers emerge from behind before layer swap', () => {
  assert.ok(css.includes('box-shadow:none'));
  assert.ok(css.includes('transition:transform 1050ms cubic-bezier(.16,1,.3,1),opacity 420ms ease'));
  assert.ok(css.includes('55%{\n    z-index:2'));
  assert.ok(css.includes('56%{\n    z-index:var(--reveal-final-layer)'));
});
