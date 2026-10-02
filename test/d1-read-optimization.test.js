import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const platformScope = readFileSync(new URL('../src/platform-scope.js', import.meta.url),'utf8');
const systemMetrics = readFileSync(new URL('../src/system-metrics-clean-router.js', import.meta.url),'utf8');
const storageMetrics = readFileSync(new URL('../src/storage-metrics-router.js', import.meta.url),'utf8');

test('platformExists asks the legacy fallback for one indexed row instead of scanning all platforms', () => {
  assert.match(platformScope, /SELECT 1 AS found/);
  assert.match(platformScope, /WHERE UPPER\(TRIM\(platform\)\)=\?/);
  assert.match(platformScope, /LIMIT 1/);
});

test('active administrative snapshots use five-minute caches with explicit refresh', () => {
  assert.match(systemMetrics, /SYSTEM_METRICS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(systemMetrics, /SYSTEM_HEALTH_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(systemMetrics, /url\.searchParams\.get\('fresh'\) === '1'/);
  assert.match(storageMetrics, /STORAGE_METRICS_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(storageMetrics, /url\.searchParams\.get\('fresh'\) === '1'/);
});
