import test from 'node:test';
import assert from 'node:assert/strict';
import { listingSalesSituation, listingPerformanceIndicators } from '../src/commerce-listing-classification.js';

test('anúncios em crescimento continuam com situação Com vendas', () => {
  const ad = { ready: true, units: 12, growing: true };
  assert.equal(listingSalesSituation(ad), 'SOLD');
  assert.deepEqual(listingPerformanceIndicators(ad), ['RISING']);
});

test('baixo volume e crescimento podem coexistir sem alterar a situação de vendas', () => {
  const ad = { ready: true, units: 3, growing: true, low_sales: true };
  assert.equal(listingSalesSituation(ad), 'SOLD');
  assert.deepEqual(listingPerformanceIndicators(ad), ['RISING', 'LOW']);
});

test('anúncio com vendas e variação sem vendas mantém a situação correta', () => {
  const ad = { ready: true, units: 4, zero_variations: 2, growing: false };
  assert.equal(listingSalesSituation(ad), 'SOLD');
  assert.deepEqual(listingPerformanceIndicators(ad), []);
});

test('anúncios sem vendas e pendentes não recebem indicadores indevidos', () => {
  assert.equal(listingSalesSituation({ ready: true, units: 0 }), 'ZERO');
  assert.deepEqual(listingPerformanceIndicators({ ready: true, units: 0, growing: true }), []);
  assert.equal(listingSalesSituation({ ready: false, units: 5 }), 'PENDING');
  assert.deepEqual(listingPerformanceIndicators({ ready: false, units: 5, low_sales: true }), []);
});
