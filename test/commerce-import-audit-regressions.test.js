import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL('../'+name, import.meta.url),'utf8');
const reader=read('src/commerce-sales-import-reader.js');
const client=read('src/commerce-import-client.js');
const center=read('src/commerce-import-center.jsx');

test('multi-month report computes a separate partial cutoff for each month',()=>{
  assert.match(reader,/latestSaleDateByMonth = new Map\(\)/);
  assert.match(reader,/latestSaleDateByMonth\.set\(item\.month_key, item\.sale_date\)/);
  assert.match(reader,/periodBoundsForImport\(monthKey, latestSaleDate\)/);
  assert.doesNotMatch(reader,/const latestSaleDate = maxDate\(raw\.map/);
});

test('sales commit timeout checks persisted status and never blindly retries commit',()=>{
  assert.match(client,/if \(!error\?\.retryable\) throw error/);
  assert.match(client,/listCommerceSalesImports\(\{ limit: 100 \}\)/);
  assert.match(client,/batch\?\.status === 'COMMITTED'/);
  assert.match(client,/recovered_after_timeout: true/);
});

test('multipart import in progress is not reported as completed',()=>{
  assert.match(center,/outcome\.status === 'WAITING_PARTS'/);
  assert.match(center,/Nenhuma venda foi consolidada ainda/);
  assert.match(center,/onSalesChanged\?\.\(\)/);
});
