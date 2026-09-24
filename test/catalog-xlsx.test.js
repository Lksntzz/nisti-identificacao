import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { createCatalogXlsx } from '../src/admin/catalog-xlsx.js';

test('Excel export keeps EAN as text and provides a filterable styled table', () => {
  const zip = unzipSync(createCatalogXlsx([
    { platform: 'Shopee', sku: 'ABC_1', nome: 'Produto & Azul', variacao: 'Azul', capa_code: 'C1', gtin: '0789123456789', id: 1, created_at: '2026-09-24' }
  ], new Date('2026-09-24T12:00:00Z')));
  const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']);
  const table = strFromU8(zip['xl/tables/table1.xml']);
  assert.match(sheet, /r="G5" s="5" t="inlineStr"><is><t xml:space="preserve">0789123456789/);
  assert.match(sheet, /Produto &amp; Azul/);
  assert.match(sheet, /mergeCell ref="A1:I1"/);
  assert.match(sheet, /ySplit="4"/);
  assert.match(table, /autoFilter ref="A4:I5"/);
  assert.match(table, /TableStyleMedium2/);
  assert.match(strFromU8(zip['xl/styles.xml']), /numFmtId="49"/);
});
