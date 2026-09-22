import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('reconciliação v3 mantém SKU duplicado como conflito mas gera candidatos', () => {
  const migration = read('supabase/migrations/202609221355_commerce_duplicate_conflict_candidates_v1.sql');
  assert.equal(migration.includes('commerce_reconcile_import_batch_v3'), true);
  assert.equal(migration.includes("error_code = 'duplicate_sku_in_batch'"), true);
  assert.equal(migration.includes('commerce_reconciliation_candidates'), true);
  assert.equal(migration.includes('duplicate_conflicts_with_candidates'), true);
});

test('Worker usa reconciliação v3', () => {
  const store = read('src/commerce-supabase-store.js');
  assert.equal(store.includes("supabaseRpc(env, 'commerce_reconcile_import_batch_v3'"), true);
});
