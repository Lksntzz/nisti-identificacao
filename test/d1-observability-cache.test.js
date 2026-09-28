import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/geometric-shadow-observability-router.js', import.meta.url),
  'utf8'
);

test('shadow observability caches expensive D1 reports for five minutes', () => {
  assert.match(source, /OBSERVABILITY_CACHE_TTL_MS = 5 \* 60 \* 1000/);
  assert.match(source, /observabilityCacheByLimit/);
  assert.match(source, /expiresAt/);
});

test('shadow observability accepts an explicit fresh=1 cache bypass', () => {
  assert.match(source, /url\.searchParams\.get\('fresh'\) === '1'/);
  assert.match(source, /forceFresh/);
});
