import test from 'node:test';
import assert from 'node:assert/strict';
import { gtin13CheckDigit, isValidGtin13, normalizeGtin } from '../src/gtin.js';

test('normalizes printable GTIN separators', () => {
  assert.equal(normalizeGtin('7898 7649-8261 7'), '7898764982617');
});

test('validates GS1 GTIN-13 checksum', () => {
  assert.equal(gtin13CheckDigit('789876498261'), '7');
  assert.equal(isValidGtin13('7898764982617'), true);
  assert.equal(isValidGtin13('7898764982618'), false);
  assert.equal(isValidGtin13('789876498261'), false);
});
