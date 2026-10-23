import test from 'node:test';
import assert from 'node:assert/strict';
import { sortedCatalogProducts } from '../src/admin/catalog-export.js';

test('sorting groups platforms and SKU families while keeping the catalog untouched', () => {
  const products = [
    { id: 3, platform: 'SHOPEE', sku: 'PB27_ROSA_BBB', nome: 'Agenda', variacao: 'Rosa', gtin: '0123456789012' },
    { id: 2, platform: 'MERCADO LIVRE', sku: 'VACMNA_CP2_BBB', nome: 'Vacinação', variacao: 'Capa 2', gtin: '7898973020780' },
    { id: 1, platform: 'SHOPEE', sku: 'PB27_AZUL_BBB', nome: 'Agenda', variacao: 'Azul', gtin: '7898973020797' },
    { id: 4, platform: 'SHOPEE', sku: 'VACMNA_CP1_BBB', nome: 'Nome; com "aspas"', variacao: '', gtin: '' }
  ];
  const before = JSON.stringify(products);
  assert.deepEqual(sortedCatalogProducts(products).map(p => p.id), [2, 1, 3, 4]);
  assert.equal(JSON.stringify(products), before);
});
