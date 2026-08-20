import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSku, WIREO_COLORS, ACCESSORY_COLORS } from '../src/sku.js';

test('parseSku parses valid SKU correctly with tassel', () => {
  const result = parseSku('CAD_A5_PBA');
  assert.equal(result.sku, 'CAD_A5_PBA');
  assert.equal(result.mioloCode, 'CAD');
  assert.equal(result.capaCode, 'A5');
  assert.equal(result.acabamentoCode, 'PBA');
  assert.equal(result.wireoCode, 'P');
  assert.equal(result.tasselCode, 'B');
  assert.equal(result.elasticoCode, 'A');
  assert.equal(result.wireo, 'Preto');
  assert.equal(result.tassel, 'Branco');
  assert.equal(result.elastico, 'Azul');
});

test('parseSku parses valid SKU without tassel (X)', () => {
  const result = parseSku('AGE_CAPA01_RXP');
  assert.equal(result.wireoCode, 'R');
  assert.equal(result.tasselCode, 'X');
  assert.equal(result.elasticoCode, 'P');
  assert.equal(result.wireo, 'Rose Gold');
  assert.equal(result.tassel, 'Sem tassel');
  assert.equal(result.elastico, 'Preto');
});

test('parseSku throws error for malformed SKU structure', () => {
  assert.throws(() => parseSku('INVALID_SKU'), /SKU deve seguir MIOLO_CAPA_ACABAMENTO/);
  assert.throws(() => parseSku('A_B_C_D'), /SKU deve seguir MIOLO_CAPA_ACABAMENTO/);
  assert.throws(() => parseSku(''), /SKU deve seguir MIOLO_CAPA_ACABAMENTO/);
});

test('parseSku throws error for invalid wire-o, tassel, or elastico color code', () => {
  assert.throws(() => parseSku('CAD_CAPA_ZBP'), /Wire-O desconhecido/);
  assert.throws(() => parseSku('CAD_CAPA_PZP'), /Tassel desconhecido/);
  assert.throws(() => parseSku('CAD_CAPA_PBZ'), /Elástico desconhecido/);
});
