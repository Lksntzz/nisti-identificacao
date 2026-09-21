import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEanCollections, collectionZipFilename } from '../src/ean-collections.js';

const product = (id, overrides = {}) => ({
  id,
  active: true,
  nome: 'Caderneta Jardim das Fadas',
  miolo_code: 'VACMNO',
  sku: `VACMNO_JDF${id}_BBB`,
  capa_code: `JDF${id}`,
  gtin: `78987649830${id}0`,
  platforms: ['SHOPEE'],
  ...overrides
});

test('groups a collection by normalized title and product family', () => {
  const collections = buildEanCollections([
    product(1),
    product(2, { nome: 'Caderneta  Jardim das Fadas' }),
    product(3, { nome: 'CADERNETA JARDIM DAS FADAS' })
  ]);
  assert.equal(collections.length, 1);
  assert.equal(collections[0].items.length, 3);
  assert.equal(collections[0].coverCount, 3);
  assert.equal(collections[0].family, 'VACMNO');
});

test('does not merge equal titles from different SKU families', () => {
  const collections = buildEanCollections([
    product(1),
    product(2, { miolo_code: 'CADISC', sku: 'CADISC_JDF2_PXP' })
  ]);
  assert.deepEqual(collections, []);
});

test('ignores inactive products, duplicate EANs and single-cover groups', () => {
  const collections = buildEanCollections([
    product(1),
    product(2, { gtin: product(1).gtin }),
    product(3, { active: false })
  ]);
  assert.deepEqual(collections, []);
});

test('creates a readable collection ZIP filename', () => {
  assert.equal(
    collectionZipFilename({ name: 'Caderneta Jardim das Fadas' }),
    'etiquetas-caderneta-jardim-das-fadas.zip'
  );
});
