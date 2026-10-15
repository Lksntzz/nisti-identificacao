import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('Large workbook reconciling bypasses costly per-product name pass without auto-linking', () => {
  const sql = read('supabase/migrations/20261014_commerce_bulk_reconciliation_fast_v2.sql');
  assert.match(sql, /commerce_reconcile_import_batch_fast_v5/);
  assert.match(sql, /v_new<=12/);
  assert.match(sql, /name_suggestions_deferred/);
  assert.match(sql, /commerce_reconcile_import_batch_fast_v6/);
  assert.match(sql, /commerce_reconcile_import_batch_fast_v7/);
  assert.match(sql, /commerce_reconcile_import_batch_account_v2/);
  assert.match(sql, /to service_role/);
  const indices = read('supabase/migrations/20261014_commerce_reconcile_product_lookup_indexes.sql');
  assert.match(indices, /commerce_products_match_key_lookup_idx/);
  assert.match(indices, /commerce_products_yearless_match_key_lookup_idx/);
});

test('Importing UI recovers a saved failed batch without re-upload and displays real progress', () => {
  const client = read('src/commerce-import-client.js');
  const view = read('src/commerce-import-center.jsx');
  const store = read('src/commerce-supabase-store.js');
  assert.match(client, /retryCommerceImportReconciliation/);
  assert.match(client, /error\.batchId = batchId/);
  assert.match(view, /Retomar comparação/);
  assert.match(view, /retryCommerceImportReconciliation\(catalogBatch\.id\)/);
  assert.match(view, /phase === 'failed'/);
  assert.match(view, /phase === 'reconcile'\) percent = Math\.min\(95/);
  assert.match(store, /commerce_reconcile_import_batch_auto_v1/);
  assert.match(store, /timeoutMs: 30000/);
});
