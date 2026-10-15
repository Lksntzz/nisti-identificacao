import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  new URL('../supabase/migrations/20261015_secure_commerce_accounts_and_mural_push_rls.sql', import.meta.url),
  'utf8'
);

const protectedTables=[
  'commerce_marketplace_accounts',
  'mural_push_deliveries',
  'mural_push_release_gate'
];

test('RLS is active on every server-only commerce and Mural table',()=>{
  for(const table of protectedTables){
    assert.match(sql,new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.match(sql,/REVOKE ALL PRIVILEGES ON TABLE/);
  assert.match(sql,/FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT ALL PRIVILEGES ON TABLE/);
  assert.match(sql,/TO service_role;/);
});

test('the RLS migration never deletes records, changes scanner data, or opens public policies',()=>{
  assert.doesNotMatch(sql,/\b(?:TRUNCATE|DELETE FROM|DROP TABLE|DROP POLICY|DISABLE ROW LEVEL SECURITY|CREATE POLICY)\b/i);
  assert.doesNotMatch(sql,/\bpublic\.(?:products|product_gtins|gtin_scan_events|product_platforms|mural_posts|mural_collections)\b/i);
  assert.match(sql,/BEGIN;/);
  assert.match(sql,/COMMIT;/);
});

test('all backend RPCs referencing these tables remain service_role only',()=>{
  const db=fs.readFileSync(new URL('../supabase/migrations/20261015_mural_scheduled_push_delivery_v2.sql',import.meta.url),'utf8');
  assert.match(db,/nisti_claim_mural_push_targets_v1/);
  assert.match(db,/nisti_list_mural_push_ready_v1/);
  assert.match(db,/GRANT EXECUTE ON FUNCTION public\.nisti_claim_mural_push_targets_v1\(bigint\) TO service_role/);
});
