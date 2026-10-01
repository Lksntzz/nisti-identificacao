import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const mural = fs.readFileSync(new URL('../src/mural-nisti.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-nisti.css', import.meta.url), 'utf8');

test('collection feed loads product previews in one batched query', () => {
  assert.ok(router.includes("filter(row => row.kind === 'collection' && row.collection_id)"));
  assert.ok(router.includes('FROM mural_collection_products mcp'));
  assert.ok(router.includes('WHERE mcp.collection_id IN (${placeholders})'));
  assert.ok(router.includes('current.items.length < 3'));
  assert.ok(router.includes('preview_products: collectionPreview?.items || []'));
  assert.ok(router.includes('product_count: Number(collectionPreview?.count || 0)'));
});

test('collection cards render curated product thumbnails in the approved launch-card layout', () => {
  assert.ok(mural.includes('function CollectionLaunchCard'));
  assert.ok(mural.includes('mural-collection-launch-products'));
  assert.ok(mural.includes('mural-collection-launch-product product-'));
  assert.ok(mural.includes('previews.slice(0, 3)'));
  assert.ok(mural.includes('NOVA COLEÇÃO'));
  assert.ok(css.includes('.mural-collection-launch-card'));
  assert.ok(css.includes('.mural-collection-launch-product'));
});

test('featured collection hero renders the 2:1 launch card from banner or real product previews', () => {
  assert.ok(mural.includes('function CollectionLaunchHero'));
  assert.ok(mural.includes('mural-launch-hero'));
  assert.ok(mural.includes('previews.slice(0, 4)'));
  assert.ok(mural.includes('mural-launch-product product-'));
  assert.ok(mural.includes('mural-launch-hero-banner'));
  assert.ok(css.includes('.mural-launch-hero'));
  assert.ok(css.includes('aspect-ratio:2 / 1'));
  assert.ok(css.includes('.mural-launch-products'));
});

test('feed exposes image source so a true editorial post image can become the hero scene', () => {
  assert.ok(router.includes("image_source: row.image_key"));
  assert.ok(router.includes("? 'post'"));
  assert.ok(mural.includes("item.image_source === 'post' && item.image_url"));
  assert.ok(mural.includes('mural-hero-scene-photo'));
});


test('collection product cutouts use one final PNG with transparent background and baked external outline', () => {
  assert.ok(mural.includes('useTreatedProductImage'));
  assert.equal(mural.includes('useTransparentProductOutline'), false);
  assert.equal(mural.includes('mural-product-outline'), false);
  assert.equal(mural.includes('outlineSrc'), false);
  assert.ok(mural.includes('mural-product-transparent'));
  assert.ok(css.includes('filter:none!important'));
  assert.equal(css.includes('drop-shadow(0 8px 11px rgba(31,41,55,.16))'), false);
});
