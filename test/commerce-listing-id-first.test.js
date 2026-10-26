import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = readFileSync(new URL('../src/commerce-supabase-store.js', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/20261026120000_commerce_listing_id_first_v1.sql', import.meta.url), 'utf8');

test('import uses the listing-id-first reconcile and commit RPCs', () => {
  assert.ok(store.includes("'commerce_reconcile_import_batch_id_first_v1'"));
  assert.ok(store.includes("'commerce_commit_import_batch_account_v5'"));
});

test('migration keeps existing link, never auto-relinks to another product, and locks RPCs', () => {
  assert.ok(sql.includes("match_method = 'LISTING_ID_EXISTING'"));
  assert.ok(sql.includes('s.product_id <> c.product_id'));
  assert.ok(sql.includes('grant execute on function public.commerce_commit_import_batch_account_v5(bigint) to service_role'));
  assert.ok(!/delete\s+from/i.test(sql));
});
