import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSource } from '../src/gtin-router.js';

test('GTIN source stays inside the production database constraint', () => {
  assert.equal(normalizeSource('GS1'), 'GS1');
  assert.equal(normalizeSource('NISTI'), 'NISTI');
  assert.equal(normalizeSource('ADMIN'), 'NISTI');
  assert.equal(normalizeSource('IMPORT'), 'NISTI');
  assert.equal(normalizeSource('unknown'), 'NISTI');
});
