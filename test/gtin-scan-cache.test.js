import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serverUnavailable, findFreshCachedEntry, withoutGtin, cachedLookupWarning, GTIN_CACHE_MAX_AGE_MS
} from '../src/gtin-scan-cache.js';

const now = Date.parse('2026-10-23T12:00:00Z');
const entry = (gtin, ageMs, id = 1) => ({
  gtin, scanned_at: new Date(now - ageMs).toISOString(), product: { id, sku: 'SKU' + id }
});

test('cache só é usado quando o servidor está inacessível', () => {
  assert.equal(serverUnavailable(0, new Error('offline')), true);
  assert.equal(serverUnavailable(503, null), true);
  assert.equal(serverUnavailable(408, null), true);
  assert.equal(serverUnavailable(429, null), true);
  for (const status of [200, 400, 401, 403, 404]) assert.equal(serverUnavailable(status, null), false, String(status));
});

test('entradas expiradas, futuras ou sem data são ignoradas', () => {
  const g = '7891234567895';
  assert.equal(findFreshCachedEntry([entry(g, GTIN_CACHE_MAX_AGE_MS + 1)], g, now), null);
  assert.equal(findFreshCachedEntry([entry(g, -60000)], g, now), null);
  assert.equal(findFreshCachedEntry([{ gtin: g, product: { id: 1 } }], g, now), null);
  assert.equal(findFreshCachedEntry([entry(g, 1000, 7)], g, now).product.id, 7);
  assert.equal(findFreshCachedEntry([entry(g, 1000)], '7890000000000', now), null);
});

test('EAN não cadastrado é removido do histórico local', () => {
  const g = '7891234567895';
  const left = withoutGtin([entry(g, 1), entry('7890000000000', 1, 2), entry(g, 2)], g);
  assert.deepEqual(left.map(e => e.gtin), ['7890000000000']);
});

test('aviso deixa claro que o dado não foi confirmado', () => {
  assert.match(cachedLookupWarning(entry('7891234567895', 1000)), /NÃO confirmados/);
});
