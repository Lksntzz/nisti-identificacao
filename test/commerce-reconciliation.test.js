import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const migrationPath = 'supabase/migrations/202609221300_commerce_reconciliation_v1.sql';

test('reconciliação prioriza SKU exato e mantém nome como correspondência provável', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes("'SKU_EXACT'::text"), true);
  assert.equal(sql.includes("'PLATFORM_SKU_EXACT'::text"), true);
  assert.equal(sql.includes("'NAME_CATEGORY_EXACT'"), true);
  assert.equal(sql.includes("'NAME_YEARLESS_EXACT'::text"), true);
  assert.equal(sql.includes("status = 'MATCHED'"), true);
  assert.equal(sql.includes("status = 'PROBABLE'"), true);
});

test('correspondência ambígua nunca é promovida automaticamente', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes("v_exact_count > 1"), true);
  assert.equal(sql.includes("status = 'CONFLICT'"), true);
  assert.equal(sql.includes("multiple_exact_sku_matches"), true);
  assert.equal(sql.includes("batch_has_manual_decisions"), true);
});

test('primeiro onboarding exige aprovação explícita para produtos novos', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes("match_method = 'NO_MATCH'"), true);
  assert.equal(sql.includes("'USER_NEW_BULK'"), true);
  assert.equal(sql.includes("new_products_not_approved"), true);
});

test('commit da importação é fail-closed para linhas não resolvidas', () => {
  const sql = read(migrationPath);
  assert.equal(sql.includes("status in ('PENDING', 'PROBABLE', 'CONFLICT', 'INVALID')"), true);
  assert.equal(sql.includes('batch_has_unresolved_rows'), true);
  assert.equal(sql.includes("source = 'EXCEL'"), true);
  assert.equal(sql.includes("set status = 'COMMITTED'"), true);
});

test('RPCs de reconciliação ficam restritas à service role', () => {
  const sql = read(migrationPath);
  for (const fn of [
    'commerce_reconcile_import_batch_v1',
    'commerce_list_import_rows_v1',
    'commerce_decide_import_row_v1',
    'commerce_approve_new_rows_v1',
    'commerce_commit_import_batch_v1'
  ]) {
    assert.equal(sql.includes(`public.${fn}`), true, `${fn} deve existir`);
  }
  assert.equal(sql.includes('from public, anon, authenticated'), true);
  assert.equal(sql.includes('to service_role'), true);
});

test('API administrativa expõe reconciliação, decisão e commit somente sob /api/admin/commerce', () => {
  const router = read('src/commerce-admin-router.js');
  assert.equal(router.includes('/reconcile'), true);
  assert.equal(router.includes('/approve-new'), true);
  assert.equal(router.includes('/commit'), true);
  assert.equal(router.includes('/decision'), true);
  assert.equal(router.includes('commerceReconcileImportBatch'), true);
  assert.equal(router.includes('commerceCommitImportBatch'), true);
});
