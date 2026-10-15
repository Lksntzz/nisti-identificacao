import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Mercado Livre import requires explicit seller account at every boundary', () => {
  const ui = read('src/commerce-import-center.jsx');
  const reader = read('src/commerce-xlsx-reader.js');
  const client = read('src/commerce-import-client.js');
  const api = read('src/commerce-admin-router.js');
  const store = read('src/commerce-supabase-store.js');
  assert.match(ui, /setCatalogAccount/);
  assert.match(ui, /Mercado Livre — Conta Antiga/);
  assert.match(ui, /Mercado Livre — Conta Nova/);
  assert.match(reader, /account_code: account/);
  assert.match(client, /account_code: parsedWorkbook.account_code/);
  assert.match(api, /Selecione Conta Antiga ou Conta Nova/);
  assert.match(store, /commerce_create_import_batch_v2/);
  assert.match(store, /commerce_commit_import_batch_account_v4/);
  assert.match(store, /commerce_reconcile_import_batch_auto_v1/);
  assert.match(store, /commerce_sync_import_listing_states_account_v1/);
});

test('Mercado Livre listing identity keys and backfill are account-aware', () => {
  const ddl = read('supabase/migrations/20261014_ml_account_isolation_v1.sql');
  assert.match(ddl, /commerce_listings_account_external_id_uq/);
  assert.match(ddl, /coalesce\(account_code,'__UNASSIGNED__'\)/);
  assert.match(ddl, /count\(distinct f.account_code\)=1/);
  assert.match(ddl, /mercado_livre_account_required/);
});

test('Account-safe commits reject ambiguity before product writes', () => {
  const sql = read('supabase/migrations/20261014_ml_account_import_rpcs.sql');
  assert.match(sql, /commerce_commit_import_batch_account_v4/);
  assert.match(sql, /legacy_listing_account_requires_review/);
  assert.match(sql, /l.account_code is not distinct from v_batch.account_code/);
  assert.match(sql, /commerce_reconcile_import_batch_account_v1/);
  assert.match(read('supabase/migrations/20261014_commerce_bulk_reconciliation_fast_v2.sql'), /commerce_reconcile_import_batch_account_v2/);
  const fix = read('supabase/migrations/20261014_ml_variation_reimport_idempotence.sql');
  assert.match(fix, /source_variation_id/);
  assert.match(fix, /not exists/);
});

test('Account-aware status and history never silently claim unassigned listing', () => {
  const sql = read('supabase/migrations/20261014_ml_account_status_history.sql');
  const store = read('src/commerce-supabase-store.js');
  const history = read('src/commerce-catalog-workspace.jsx');
  assert.match(sql, /ambiguous_unassigned/);
  assert.match(sql, /l.account_code is null/);
  assert.match(sql, /l.account_code=v_batch.account_code/);
  assert.match(sql, /commerce_listing_history_account_v1/);
  assert.match(store, /p_account_code: normalizedAccount/);
  assert.match(history, /Conta não identificada/);
  assert.match(history, /account_code: account/);
});
