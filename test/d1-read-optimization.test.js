import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../migrations/0013_d1_read_optimization.sql', import.meta.url),
  'utf8'
);
const platformScope = readFileSync(
  new URL('../src/platform-scope.js', import.meta.url),
  'utf8'
);
const systemMetrics = readFileSync(
  new URL('../src/system-metrics-clean-router.js', import.meta.url),
  'utf8'
);
const storageMetrics = readFileSync(
  new URL('../src/storage-metrics-router.js', import.meta.url),
  'utf8'
);

test('v8.24.3 adds expression indexes matching normalized hot-path predicates', () => {
  assert.match(migration, /idx_products_capa_normalized_id/);
  assert.match(migration, /ON products\(UPPER\(TRIM\(capa_code\)\), id\)/);
  assert.match(migration, /idx_product_platforms_platform_normalized_product/);
  assert.match(migration, /ON product_platforms\(UPPER\(TRIM\(platform\)\), product_id, id\)/);
  assert.match(migration, /idx_cover_visual_references_capa_normalized_active_id/);
  assert.match(migration, /idx_recognition_events_kind_id/);
  assert.match(migration, /idx_recognition_events_operator_name_id/);
  assert.match(migration, /PRAGMA optimize;/);
});

test('v8.24.3 platformExists asks D1 for one indexed row instead of scanning all platforms', () => {
  assert.match(platformScope, /SELECT 1 AS found/);
  assert.match(platformScope, /WHERE UPPER\(TRIM\(platform\)\)=\?/);
  assert.match(platformScope, /LIMIT 1/);
  assert.doesNotMatch(
    platformScope,
    /export async function platformExists[\s\S]*?SELECT DISTINCT UPPER\(TRIM\(platform\)\)[\s\S]*?return \(results \|\| \[\]\)\.some/
  );
});

test('v8.24.3 vector footprint pre-aggregates platform scope instead of correlated count per reference', () => {
  assert.match(systemMetrics, /product_platform_counts AS/);
  assert.match(systemMetrics, /cover_platform_counts AS/);
  assert.match(systemMetrics, /LEFT JOIN product_platform_counts product_scope/);
  assert.match(systemMetrics, /LEFT JOIN cover_platform_counts cover_scope/);
  assert.doesNotMatch(systemMetrics, /WHEN r\.source_product_id IS NOT NULL THEN \(\s*SELECT COUNT/);
});

test('v8.24.3 caches expensive global ADM snapshots for five minutes', () => {
  assert.match(systemMetrics, /SYSTEM_METRICS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(systemMetrics, /OPERATOR_STATS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(systemMetrics, /url\.searchParams\.get\('fresh'\) === '1'/);
  assert.match(storageMetrics, /STORAGE_METRICS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(storageMetrics, /url\.searchParams\.get\('fresh'\) === '1'/);
});
