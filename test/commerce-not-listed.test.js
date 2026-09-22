import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('linhas explicitamente não cadastradas são reconciliadas sem fabricar anúncio', () => {
  const sql = read('supabase/migrations/202609221335_commerce_not_listed_rows_v2.sql');
  assert.equal(sql.includes("normalized_payload->>'update_hint'"), true);
  assert.equal(sql.includes("= 'NOT_LISTED'"), true);
  assert.equal(sql.includes("matched_listing_id = null"), true);
  assert.equal(sql.includes('commerce_commit_import_batch_v1(p_batch_id)'), true);
});

test('store administrativo usa RPCs v2 para reconcile/approve/commit', () => {
  const source = read('src/commerce-supabase-store.js');
  assert.equal(source.includes("'commerce_reconcile_import_batch_v2'"), true);
  assert.equal(source.includes("'commerce_approve_new_rows_v2'"), true);
  assert.equal(source.includes("'commerce_commit_import_batch_v2'"), true);
});

test('produto sem anúncio só é criado após aprovação explícita', () => {
  const sql = read('supabase/migrations/202609221335_commerce_not_listed_rows_v2.sql');
  assert.equal(sql.includes("'USER_NEW_BULK_NOT_LISTED'"), true);
  assert.equal(sql.includes("raise exception 'new_products_not_approved'"), true);
});
