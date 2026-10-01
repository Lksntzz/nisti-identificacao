import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const router=fs.readFileSync('src/geometric-shadow-evidence-router.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261001252000_primary_geometric_shadow_summary_v1.sql','utf8');

test('geometric shadow evidence no longer requires D1 in Supabase primary mode',()=>{
  assert.match(router,/nisti_record_geometric_shadow_evidence_v1/);
  assert.match(router,/nisti_geometric_shadow_summary_rows_v1/);
  assert.match(router,/!env\?\.DB && !supabasePrimaryWritesRequested\(env\)/);
  assert.match(router,/!env\?\.DB && !supabaseReadsRequested\(env\)/);
});

test('geometric shadow summary RPC is invoker-only and service-role-only',()=>{
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.nisti_geometric_shadow_summary_rows_v1\(\)/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.nisti_geometric_shadow_summary_rows_v1\(\)/);
});
