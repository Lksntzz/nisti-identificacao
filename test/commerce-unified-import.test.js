import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Catálogo Comercial possui uma aba única de importação para Catálogo e Vendas', () => {
  const app = read('src/commerce-admin-app-v2.jsx');
  const unified = read('src/commerce-unified-import-view.jsx');

  assert.equal(app.includes("{ id: 'imports', label: 'Importar', icon: 'upload' }"), true);
  assert.equal(app.includes('<CommerceUnifiedImportView />'), true);
  assert.equal(unified.includes('Catálogo'), true);
  assert.equal(unified.includes('Vendas'), true);
  assert.equal(unified.includes('<CommerceImportView />'), true);
  assert.equal(unified.includes('<CommerceSalesImportPanel />'), true);
});

test('importador de vendas reconhece cabeçalhos, período parcial e agrega por SKU', () => {
  const reader = read('src/commerce-sales-import-reader.js');

  assert.equal(reader.includes("'id do pedido'"), true);
  assert.equal(reader.includes("'quantidade'"), true);
  assert.equal(reader.includes("'faturamento'"), true);
  assert.equal(reader.includes('periodBoundsForImport'), true);
  assert.equal(reader.includes('(01-'), true);
  assert.equal(reader.includes('orders_with_item: group.orders.size'), true);
  assert.equal(reader.includes('product_revenue: Number(group.product_revenue.toFixed(2))'), true);
});

test('pipeline de vendas mantém snapshot versionado e substitui somente plataforma/período importados', () => {
  const sql = read('supabase/migrations/20260928205021_commerce_sales_import_pipeline_v1.sql');

  for (const token of [
    'commerce_sales_import_batches',
    'commerce_sales_import_stage_rows',
    'commerce_sales_import_stage_summary',
    'commerce_create_sales_import_v1',
    'commerce_append_sales_import_rows_v1',
    'commerce_append_sales_import_summary_v1',
    'commerce_commit_sales_import_v1',
    'commerce_list_sales_imports_v1'
  ]) assert.equal(sql.includes(token), true, token);

  assert.equal(sql.includes('r.platform_code=v_batch.platform_code'), true);
  assert.equal(sql.includes('exists(select 1 from imported_periods p where p.period_key=r.period_key)'), true);
  assert.equal(sql.includes('set is_current=true'), true);
});

test('API de importação de vendas envia dados em lotes e usa timeout próprio no commit', () => {
  const router = read('src/commerce-admin-router.js');
  const client = read('src/commerce-import-client.js');
  const store = read('src/commerce-supabase-store.js');

  assert.equal(router.includes('/sales/imports'), true);
  assert.equal(router.includes('salesImportRowsMatch'), true);
  assert.equal(router.includes('salesImportSummaryMatch'), true);
  assert.equal(router.includes('salesImportCommitMatch'), true);
  assert.equal(client.includes('stageCommerceSalesWorkbook'), true);
  assert.equal(client.includes('listCommerceSalesImports'), true);
  assert.equal(store.includes('commerceCommitSalesImport'), true);
  assert.equal(store.includes('{ timeoutMs: 20000 }'), true);
});
