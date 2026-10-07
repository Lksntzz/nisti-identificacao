import test from 'node:test';
import assert from 'node:assert/strict';
import { productFinishLabels } from '../src/gtin-router.js';
import { normalizeGtinProduct } from '../src/gtin-product-normalizer.js';
import fs from 'node:fs';

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


test('translates X elastic code as product without elastic', () => {
  assert.deepEqual(productFinishLabels({
    wireo_code: 'B',
    tassel_code: 'P',
    elastico_code: 'X'
  }), {
    wireo: 'Branco',
    tassel: 'Preto',
    elastico: 'Sem elástico'
  });
});


test('finish endpoint accepts X as the no-elastic code', () => {
  const source = fs.readFileSync(new URL('../src/product-finish-router.js', import.meta.url), 'utf8');
  assert.match(source, /elasticoCode !== 'X' && !ACCESSORY_COLORS\[elasticoCode\]/);
  assert.match(source, /elasticoCode === 'X' \? 'Sem elástico'/);
});


test('normalizes scanner finish labels from SKU codes', () => {
  const product = normalizeGtinProduct({
    sku: 'VACMNO_PQV1_PBX',
    wireo: 'P',
    tassel: 'B',
    elastico: 'B'
  });

  assert.equal(product.wireo, 'Preto');
  assert.equal(product.tassel, 'Sim');
  assert.equal(product.elastico, 'Sem elástico');
});

test('normalizes a product without tassel from SKU X', () => {
  const product = normalizeGtinProduct({
    sku: 'VACMNO_PQV1_BXB'
  });

  assert.equal(product.wireo, 'Branco');
  assert.equal(product.tassel, 'Não');
  assert.equal(product.elastico, 'Branco');
});
