import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = name => fs.readFileSync(new URL('../'+name, import.meta.url),'utf8');
const reader=read('src/ga/commerce-sales-import-reader.js');
const client=read('src/ga/commerce-import-client.js');
const center=read('src/ga/commerce-import-center.jsx');

test('GA-019: report is staged by real order DAY, never as a month that replaces the saved month',()=>{
  // Linhas e resumos têm o dia real do pedido; o mês é montado pelo banco a partir dos dias.
  assert.match(reader,/period_key: group\.sale_date/);
  assert.match(reader,/period_key: item\.sale_date/);
  assert.doesNotMatch(reader,/latestSaleDateByMonth/);
  assert.doesNotMatch(reader,/periodBoundsForImport/);
  assert.doesNotMatch(reader,/\(01-/);
  // Sem data ou sem ID do pedido a importação para: nada de data inventada pelo nome do arquivo.
  assert.match(reader,/pedido sem data reconhecível/);
  assert.match(reader,/pedido sem identificador/);
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
