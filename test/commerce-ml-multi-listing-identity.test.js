import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('supabase/migrations/20261015220000_ml_same_sku_multiple_ads_fix.sql','utf8');

test('duplicate detection scopes official ML rows to the same seller listing', () => {
  assert.ok(sql.includes("other.normalized_payload->>'external_listing_id' = v_row.normalized_payload->>'external_listing_id'"));
  assert.ok(sql.includes("other.status <> 'INVALID'"));
  assert.ok(sql.includes('commerce_reconcile_import_batch_v1'));
  assert.ok(sql.includes("other.normalized_payload->>'sku_primary'"));
});

test('unmatched ML SKUs are not bulk-created without Scanner identity', () => {
  assert.ok(sql.includes('commerce_auto_link_ml_active_v1(p_batch_id)'));
  assert.ok(sql.includes("match_method='ML_SCANNER_IDENTITY_PENDING'"));
  assert.ok(sql.includes("r.status='NEW_PRODUCT'"));
  assert.ok(sql.includes("status='PROBABLE'"));
  assert.ok(sql.includes("matched_product_id=null"));
  assert.ok(sql.includes("to service_role"));
});