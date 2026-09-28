import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('aprovação em lote de prováveis exige candidato único, nome e categoria exatos', () => {
  const sql = read('supabase/migrations/202609221445_commerce_probable_bulk_approval_v1.sql');

  assert.equal(sql.includes("r.status = 'PROBABLE'"), true);
  assert.equal(sql.includes("r.match_method in ('PROBABLE_CANDIDATE', 'PROBABLE_NOT_LISTED')"), true);
  assert.equal(sql.includes("rc.match_method = 'NAME_CATEGORY_EXACT'"), true);
  assert.equal(sql.includes('rc.match_score >= 0.95000'), true);
  assert.equal(sql.includes('select count(*)'), true);
  assert.equal(sql.includes('= 1'), true);
  assert.equal(sql.includes("match_method = 'USER_CONFIRMED_BULK_NAME_CATEGORY'"), true);
  assert.equal(sql.includes("status = 'MATCHED'"), true);
});

test('RPC segura existe nos namespaces live e preview e continua service-role only', () => {
  const sql = read('supabase/migrations/202609221445_commerce_probable_bulk_approval_v1.sql');

  assert.equal(sql.includes('commerce_approve_probable_rows_v1'), true);
  assert.equal(sql.includes('commerce_preview_approve_probable_rows_v1'), true);
  assert.equal(sql.includes('revoke all on function public.commerce_approve_probable_rows_v1(bigint) from public, anon, authenticated'), true);
  assert.equal(sql.includes('grant execute on function public.commerce_approve_probable_rows_v1(bigint) to service_role'), true);
});

test('API e UI exigem confirmação explícita antes da aprovação em lote', () => {
  const router = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  const client = read('src/commerce-import-client.js');
  const view = read('src/commerce-import-view.jsx');

  assert.equal(router.includes('/approve-probable'), true);
  assert.equal(store.includes("commerce_approve_probable_rows_v1"), true);
  assert.equal(store.includes("commerce_import_batch_v2"), true);
  assert.equal(client.includes('/approve-probable'), true);
  assert.equal(view.includes('window.confirm'), true);
  assert.equal(view.includes('approvable_probable_count'), true);
  assert.equal(view.includes('nome e categoria exatos'), true);
  assert.equal(view.includes('exatamente um candidato'), true);
});
