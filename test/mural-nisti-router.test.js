import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');
const edgeRouter = fs.readFileSync(new URL('../src/edge-router.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0019_mural_nisti.sql', import.meta.url), 'utf8');

test('mural router exposes phase 1 public endpoints', () => {
  for (const route of [
    "/api/mural",
    "/api/mural/unread-count",
    "/api/mural/mark-all-read",
    "/api/mural/collections/"
  ]) assert.match(source, new RegExp(route.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')));
  assert.ok(source.includes("path.match(/^\\/api\\/mural\\/(\\d+)\\/read$/)"));
});

test('mural feed excludes unpublished, future and expired content', () => {
  assert.match(source, /mp\.status = 'published'/);
  assert.match(source, /datetime\(mp\.published_at\) <= CURRENT_TIMESTAMP/);
  assert.match(source, /mp\.expires_at IS NULL OR datetime\(mp\.expires_at\) > CURRENT_TIMESTAMP/);
});

test('mural router is registered before app fallback', () => {
  assert.match(edgeRouter, /handleMuralRequest/);
  const muralPosition = edgeRouter.indexOf('handleMuralRequest');
  const appPosition = edgeRouter.lastIndexOf('return app.fetch');
  assert.ok(muralPosition >= 0 && muralPosition < appPosition);
});

test('mural migration contains required entities and indexes', () => {
  for (const table of [
    'mural_collections',
    'mural_collection_products',
    'mural_posts',
    'mural_post_reads'
  ]) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));

  assert.match(migration, /idx_mural_posts_feed/);
  assert.match(migration, /idx_mural_collection_products_product_id/);
});
