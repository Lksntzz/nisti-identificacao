import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlatform,
  supportedPlatforms
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
