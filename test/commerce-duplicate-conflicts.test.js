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

test('v4 resolve colisão causada apenas pelo SKU secundário e preserva duplicidade real de SKU base', () => {
  const migration = read('supabase/migrations/202609221500_commerce_secondary_sku_collision_repair_v1.sql');
  assert.equal(migration.includes('commerce_reconcile_import_batch_v4'), true);
  assert.equal(migration.includes('commerce_resolve_primary_unique_duplicate_conflicts_v1'), true);
  assert.equal(migration.includes('v_primary_rows <> 1'), true);
  assert.equal(migration.includes("match_method = 'SKU_PRIMARY_EXACT'"), true);
  assert.equal(migration.includes('resolved_secondary_sku_collisions'), true);
});

test('commit v3 preserva SKU secundário conflitante apenas como platform_sku', () => {
  const migration = read('supabase/migrations/202609221500_commerce_secondary_sku_collision_repair_v1.sql');
  assert.equal(migration.includes('commerce_commit_import_batch_v3'), true);
  assert.equal(migration.includes("normalized_payload = normalized_payload - 'sku_secondary'"), true);
  assert.equal(migration.includes('platform_sku = v_secondary'), true);
  assert.equal(migration.includes('product_sku_id = null'), true);
  assert.equal(migration.includes('platform_sku_owned_by_product'), true);
});

test('Worker usa reconciliação v5 e commit v3', () => {
  const store = read('src/commerce-supabase-store.js');
  assert.equal(store.includes("supabaseRpc(env, 'commerce_reconcile_import_batch_v5'"), true);
  assert.equal(store.includes("supabaseRpc(env, 'commerce_commit_import_batch_v3'"), true);
});
