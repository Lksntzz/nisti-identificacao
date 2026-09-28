import test from 'node:test';
import assert from 'node:assert/strict';
import { productFinishLabels } from '../src/gtin-router.js';

test('translates stored finish codes for the EAN product response', () => {
  assert.deepEqual(productFinishLabels({
    wireo_code: 'R',
    tassel_code: 'X',
    elastico_code: 'A'
  }), {
    wireo: 'Rose Gold',
    tassel: 'Sem tassel',
    elastico: 'Azul'
  });
});

test('preserves an unknown finish code instead of hiding product data', () => {
  assert.deepEqual(productFinishLabels({
    wireo_code: 'Z',
    tassel_code: 'Q',
    elastico_code: null
  }), {
    wireo: 'Z',
    tassel: 'Q',
    elastico: null
  });
});
