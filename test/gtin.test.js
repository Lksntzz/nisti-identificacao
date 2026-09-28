import test from 'node:test';
import assert from 'node:assert/strict';
import { gtin13CheckDigit, isValidGtin13, normalizeGtin, requireValidGtin13 } from '../src/gtin.js';

test('validates known NISTI GTIN-13 values', () => {
  const values = [
    '7898764983362',
    '7898764983386',
    '7898764983393',
    '7898764983072',
    '7898764983089',
    '7898764983096',
    '7898764983102'
  ];

  for (const gtin of values) {
    assert.equal(isValidGtin13(gtin), true, gtin);
    assert.equal(requireValidGtin13(gtin), gtin);
  }
});

test('rejects malformed and checksum-invalid GTINs', () => {
  assert.equal(isValidGtin13('7898765983362'), false);
  assert.equal(isValidGtin13('789876498336'), false);
  assert.equal(isValidGtin13('789876498336A'), false);
  assert.throws(() => requireValidGtin13('7898765983362'), /inválido/i);
});

test('computes GTIN-13 check digit deterministically', () => {
  assert.equal(gtin13CheckDigit('789876498336'), 2);
  assert.equal(gtin13CheckDigit('789876498307'), 2);
  assert.equal(gtin13CheckDigit('789876498310'), 2);
});

test('normalizes surrounding whitespace only', () => {
  assert.equal(normalizeGtin(' 7898764983362\n'), '7898764983362');
  assert.equal(normalizeGtin('7898-7649-83362'), '7898-7649-83362');
});
