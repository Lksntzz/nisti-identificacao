import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  'supabase/migrations/20261002015500_post_cutover_fk_indexes_v1.sql',
  'utf8'
);

test('active Supabase foreign keys have explicit covering indexes',()=>{
  assert.match(sql,/CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_product_id[\s\S]*gtin_scan_events\(product_id\)/);
  assert.match(sql,/CREATE INDEX IF NOT EXISTS commerce_sales_import_batches_snapshot_id_idx[\s\S]*commerce_sales_import_batches\(snapshot_id\)/);
});

test('index-only migration does not mutate table data',()=>{
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});
