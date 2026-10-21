import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, catalogRowsFromCsv } from '../src/admin/catalog-csv-parser.js';

test('CSV parser returns no rows for empty content or blank lines', () => {
  assert.deepEqual(parseCsv(''), []);
  assert.deepEqual(parseCsv('\n\r\n,\n'), []);
  assert.deepEqual(catalogRowsFromCsv(''), []);
});

test('CSV parser preserves quoted commas, escaped quotes and embedded newlines', () => {
  assert.deepEqual(parseCsv('sku,nome\r\n"SKU,A","Agenda ""Premium""\nGrande"\r\n'), [
    ['sku', 'nome'],
    ['SKU,A', 'Agenda "Premium"\nGrande']
  ]);
});

test('CSV parser removes BOM from UTF-8 files and handles CRLF', () => {
  assert.deepEqual(parseCsv('\uFEFFsku,ean\r\nX,789\r\n'), [
    ['sku', 'ean'],
    ['X', '789']
  ]);
});

test('catalog import maps named headers and retains EAN formatting as before', () => {
  const rows = catalogRowsFromCsv('SKU,NOME,VARIAÇÃO,PLATAFORMA,EAN,URL\r\nSKU_01,"Agenda, Grande",Rosa,Shopee,789.456-123,https://example.test/1');
  assert.deepEqual(rows, [{
    nome: 'Agenda, Grande', variacao: 'Rosa', platform: 'Shopee', sku: 'SKU_01',
    gtin: '789.456-123', link: 'https://example.test/1'
  }]);
});

test('catalog import accepts common alias headers for product and GTIN', () => {
  const rows = catalogRowsFromCsv('produto,capa,platform,gtin-13,link,sku\nCaderno,Azul,Mercado Livre,7890123456789,https://example.test/2,ABC');
  assert.deepEqual(rows, [{
    nome: 'Caderno', variacao: 'Azul', platform: 'Mercado Livre', sku: 'ABC',
    gtin: '7890123456789', link: 'https://example.test/2'
  }]);
});

test('catalog import preserves headerless positional files', () => {
  const rows = catalogRowsFromCsv('unused,unused,Agenda Verde,Verde,Shopee,SKU-2,https://example.test/3,789.012.345-6789');
  assert.deepEqual(rows, [{
    nome: 'Agenda Verde', variacao: 'Verde', platform: 'Shopee', sku: 'SKU-2',
    gtin: '7890123456789', link: 'https://example.test/3'
  }]);
});

test('catalog import ignores empty SKUs and repeated header lines but does not deduplicate products', () => {
  const rows = catalogRowsFromCsv('sku,nome,ean\nA,Agenda 1,111\n,Sem SKU,222\nSKU,Nome,EAN\nA,Agenda 2,333\n');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.sku,row.nome,row.gtin]), [['A','Agenda 1','111'],['A','Agenda 2','333']]);
});

test('main admin app imports pure parser while keeping existing upload integration', () => {
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes("import { catalogRowsFromCsv } from './admin/catalog-csv-parser.js';"));
  assert.ok(source.includes('catalogRowsFromCsv(await file.text())'));
  assert.equal(source.includes('function catalogRowsFromCsv('),false);
  assert.equal(source.includes('function parseCsv('),false);
});
