import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlatform,
  supportedPlatforms,
  platformNamespace,
  platformVectorId
} from '../src/platform-scope.js';

test('normalizePlatform canonicalizes valid platforms', () => {
  assert.equal(normalizePlatform('Mercado Livre'), 'MERCADO LIVRE');
  assert.equal(normalizePlatform('mercado livre antigo'), 'MERCADO LIVRE');
  assert.equal(normalizePlatform('MERCADO_LIVRE'), 'MERCADO LIVRE');
  assert.equal(normalizePlatform('Shopee'), 'SHOPEE');
  assert.equal(normalizePlatform('shopee'), 'SHOPEE');
  assert.equal(normalizePlatform('Amazon'), 'AMAZON');
  assert.equal(normalizePlatform('amazon'), 'AMAZON');
});

test('normalizePlatform rejects unknown platforms', () => {
  assert.equal(normalizePlatform('Magalu'), '');
  assert.equal(normalizePlatform(''), '');
  assert.equal(normalizePlatform(null), '');
});

test('supportedPlatforms returns canonical list', () => {
  const platforms = supportedPlatforms();
  assert.deepEqual(platforms, ['MERCADO LIVRE', 'SHOPEE', 'AMAZON']);
});

test('platformNamespace produces valid slug for Vectorize namespaces', () => {
  assert.equal(platformNamespace('MERCADO LIVRE'), 'mercado-livre');
  assert.equal(platformNamespace('SHOPEE'), 'shopee');
  assert.equal(platformNamespace('AMAZON'), 'amazon');
  assert.equal(platformNamespace('Invalid'), '');
});

test('platformVectorId formats vector id correctly', () => {
  assert.equal(platformVectorId(42, 'MERCADO LIVRE'), 'ref:42:p:mercado-livre');
  assert.equal(platformVectorId(105, 'Shopee'), 'ref:105:p:shopee');
  assert.equal(platformVectorId(0, 'Amazon'), '');
  assert.equal(platformVectorId('invalid', 'Amazon'), '');
});
