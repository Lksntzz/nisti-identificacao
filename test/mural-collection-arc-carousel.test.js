import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('published collections open with the reusable real-cover arc carousel', () => {
  assert.ok(mural.includes('function CollectionArcCarousel'));
  assert.ok(mural.includes('products={products}'));
  assert.ok(mural.includes('mural-collection-arc-card'));
  assert.ok(mural.includes('CollectionProductImage product={product}'));
  assert.ok(mural.includes('CollectionFinishChips product={activeProduct}'));
});

test('collection arc supports swipe, keyboard navigation and five visible cover slots', () => {
  assert.ok(mural.includes('onPointerDown={handlePointerDown}'));
  assert.ok(mural.includes("event.key === 'ArrowLeft'"));
  assert.ok(mural.includes("event.key === 'ArrowRight'"));
  assert.ok(mural.includes('Math.abs(entry.distance) <= 2'));
  assert.ok(css.includes('.mural-collection-arc-card.slot-negative-2'));
  assert.ok(css.includes('.mural-collection-arc-card.slot-positive-2'));
});

test('collection covers rise from the lower edge and reduced motion remains supported', () => {
  assert.ok(css.includes('transform:translate3d(-50%,155px,0) rotate(0) scale(.54)'));
  assert.ok(css.includes('.mural-collection-arc.is-ready .mural-collection-arc-card.slot-center'));
  assert.ok(css.includes('@media (prefers-reduced-motion:reduce)'));
});
