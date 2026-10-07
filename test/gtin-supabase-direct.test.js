import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizeGtinProduct } from '../src/gtin-product-normalizer.js';

const scanner = fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx', import.meta.url), 'utf8');

test('scanner resolves EAN only through the same-origin Worker API', () => {
  assert.match(scanner, /fetch\(\`\/api\/gtin\/\$\{encodeURIComponent\(gtin\)\}\`/);
  assert.doesNotMatch(scanner, /lookupGtinDirect/);
  assert.doesNotMatch(scanner, /supabase\.co\/functions\/v1\/gtin-lookup/);
});

test('scanner retains local history only as a last-resort display cache', () => {
  const workerIndex = scanner.indexOf('fetch(`/api/gtin/${encodeURIComponent(gtin)}`');
  const cacheIndex = scanner.indexOf('cachedProductForGtin(gtin)', workerIndex);
  assert.ok(workerIndex >= 0);
  assert.ok(cacheIndex > workerIndex);
});

test('scanner expands accessory finish codes into readable color names', () => {
  const product = normalizeGtinProduct({
    wireo_code:'R',
    tassel_code:'A',
    elastico_code:'V'
  });
  assert.equal(product.wireo,'Rose Gold');
  assert.equal(product.tassel,'Azul');
  assert.equal(product.elastico,'Verde');
  assert.equal(normalizeGtinProduct({ tassel_code:'X', elastico_code:'X' }).tassel,'Sem tassel');
  assert.equal(normalizeGtinProduct({ tassel_code:'X', elastico_code:'X' }).elastico,'Sem elástico');
});
