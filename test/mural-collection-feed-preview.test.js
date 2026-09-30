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

test('collection card renders product thumbnails and total in the Coleções tab', () => {
  assert.ok(mural.includes("const collectionPreviews = isCollection ? (item.collection?.preview_products || []) : []"));
  assert.ok(mural.includes('mural-collection-card-products'));
  assert.ok(mural.includes('mural-collection-card-product-preview'));
  assert.ok(mural.includes('mural-collection-card-product-count'));
  assert.ok(mural.includes("collectionPreviews.length ? ' has-products' : ''"));
});

test('collection preview layout is mobile-aware and does not require relational selectors', () => {
  assert.ok(css.includes('.mural-collection-card-products{'));
  assert.ok(css.includes('.mural-card-collection.has-products .mural-collection-card-copy'));
  assert.equal(css.includes(':has(.mural-collection-card-products)'), false);
  assert.ok(css.includes('@media (max-width:390px)'));
});