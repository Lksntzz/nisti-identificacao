import test from 'node:test';
import assert from 'node:assert/strict';
import { commerceSalesImportInternals } from '../src/commerce-sales-import-reader.js';

test('Shopee product subtotal and variation SKU beat generic aliases', () => {
  const heading = ['ID do pedido','Status do pedido','Nº de referência do SKU principal',
    'Número de referência SKU','Quantidade','Subtotal do produto','Valor Total','Hora do pagamento do pedido'];
  const original = commerceSalesImportInternals.detectHeader([heading]);
  assert.equal(original.columns.revenue, 6, 'generic alias would choose order total');
  const fixed = commerceSalesImportInternals.resolveShopeeSalesColumns(original, heading);
  assert.equal(fixed.columns.sku, 3);
  assert.equal(fixed.columns.sku_primary, 2);
  assert.equal(fixed.columns.revenue, 5);
  const row = ['123','Concluído',null,'PB26_Cactus',2,'59.80','73.20','2026-09-10 10:00'];
  assert.equal(row[fixed.columns.sku], 'PB26_Cactus');
  assert.equal(Number(row[fixed.columns.revenue]),59.8);
  assert.equal(row[fixed.columns.sku_primary], null);
});

test('Shopee mapping fails closed without product subtotal or variation SKU',()=>{
  const original = {columns:{}};
  assert.throws(()=>commerceSalesImportInternals.resolveShopeeSalesColumns(original,['Valor Total','Número de referência SKU']),/Subtotal do produto/);
  assert.throws(()=>commerceSalesImportInternals.resolveShopeeSalesColumns(original,['Valor Total','Subtotal do produto']),/Número de referência SKU/);
});
