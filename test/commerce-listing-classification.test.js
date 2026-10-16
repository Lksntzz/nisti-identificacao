import test from 'node:test';
import assert from 'node:assert/strict';
import { listingSalesSituation } from '../src/commerce-listing-classification.js';

test('anúncios que venderam seguem como Com vendas independentemente de crescimento', () => {
  assert.equal(listingSalesSituation({ ready: true, units: 12, growing: true }), 'SOLD');
  assert.equal(listingSalesSituation({ ready: true, units: 3, low_sales: true }), 'SOLD');
  assert.equal(listingSalesSituation({ ready: true, units: 3, growing: true, low_sales: true }), 'SOLD');
});

test('variações sem vendas não apagam as vendas do anúncio', () => {
  assert.equal(listingSalesSituation({ ready: true, units: 4, zero_variations: 2 }), 'SOLD');
});

test('anúncios com zero unidades e cobertura válida mostram Sem vendas', () => {
  assert.equal(listingSalesSituation({ ready: true, units: 0 }), 'ZERO');
});

test('ausência de dados confiáveis não deve ser classificada como zero vendas', () => {
  assert.equal(listingSalesSituation({ ready: false, units: 0 }), 'PENDING');
  assert.equal(listingSalesSituation({ ready: false, units: 5 }), 'PENDING');
  assert.equal(listingSalesSituation(null), 'PENDING');
});
