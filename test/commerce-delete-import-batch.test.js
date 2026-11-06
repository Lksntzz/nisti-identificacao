import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('A exclusão do lote é restrita aos dados temporários e bloqueia importações concluídas', () => {
  const sql = read('supabase/migrations/20261014_commerce_delete_import_batch_v1.sql');
  assert.match(sql, /commerce_delete_import_batch_v1/);
  assert.match(sql, /committed_import_cannot_be_deleted/);
  assert.match(sql, /commerce_import_rows/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /from public,anon,authenticated/);
});

test('O histórico permite apagar somente com confirmação, sem apagar anúncios', () => {
  const ui = read('src/ga/commerce-import-center.jsx');
  const client = read('src/ga/commerce-import-client.js');
  const store = read('src/ga/commerce-supabase-store.js');
  const router = read('src/ga/commerce-admin-router.js');
  assert.match(ui, /window\.confirm/);
  assert.match(ui, /deleteCommerceImport\(item\.id\)/);
  assert.match(ui, /item\.status !== 'COMMITTED'/);
  assert.match(ui, /setCatalogBatch\(null\)/);
  assert.match(client, /method: 'DELETE'/);
  assert.match(store, /commerce_delete_import_batch_v1/);
  assert.match(router, /commerceDeleteImportBatch/);
  assert.match(router, /commerceCommitEnabled\(env\)/);
});
