import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const experience = fs.readFileSync(new URL('../src/mural-product-experience.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('part 7 routes collection cards directly to the collection showcase', () => {
  assert.ok(mural.includes("const opensCollection = item.kind === 'collection' && item.collection?.slug"));
  assert.ok(mural.includes('setCollectionSlug(item.collection.slug)'));
  assert.ok(mural.includes('setSelected(null)'));
});

test('part 7 makes the collection look curated with collage, principal cover and variations', () => {
  assert.ok(mural.includes('mural-collection-editorial-hero'));
  assert.ok(mural.includes('mural-collection-collage'));
  assert.ok(mural.includes('mural-collection-featured-product'));
  assert.ok(mural.includes('Outras capas da coleção'));
  assert.ok(mural.includes('CAPA PRINCIPAL'));
  assert.ok(mural.includes('mural-collection-variant-card'));
  assert.ok(css.includes('.mural-collection-editorial-media'));
  assert.ok(css.includes('.mural-collection-featured-product'));
});

test('part 7 keeps broken collection product images resilient', () => {
  assert.ok(mural.includes('function CollectionProductImage'));
  assert.ok(mural.includes('onError={() => setFailed(true)}'));
  assert.ok(mural.includes('<KindIcon kind="product" />'));
});

test('part 7 removes pseudo rotation and replaces it with focus-driven visual effects', () => {
  assert.equal(experience.includes("getContext('webgl'"), false);
  assert.ok(experience.includes('data-focus={focus.key}'));
  assert.ok(experience.includes('setActiveFocus(index)'));
  assert.ok(css.includes('.mural-product-focus-stage[data-focus="identity"]'));
  assert.ok(css.includes('.mural-product-focus-stage[data-focus="finishes"]'));
});
