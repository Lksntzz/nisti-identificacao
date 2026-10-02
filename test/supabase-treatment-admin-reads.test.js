import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
const reads=fs.readFileSync(new URL('../src/supabase-read-store.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261001223000_product_treatment_admin_reads_v1.sql',import.meta.url),'utf8');

test('treatment admin reads expose Supabase summary and paginated queue RPCs',()=>{
  for(const name of ['nisti_product_treatment_summary_v1','nisti_product_treatment_queue_v1']) {
    assert.ok(reads.includes(name));
    assert.ok(sql.includes(name));
  }
  assert.ok(sql.includes("'work','pending','review','stale','failed'"));
  assert.ok(sql.includes("'total'"));
  assert.ok(sql.includes("'offset'"));
  assert.ok(sql.includes("'limit'"));
});

test('treatment admin read RPCs are invoker-only and service-role-only',()=>{
  assert.ok(!sql.includes('SECURITY DEFINER'));
  for(const name of ['nisti_product_treatment_summary_v1','nisti_product_treatment_queue_v1']) {
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});

test('treatment GET handlers are Supabase-only after the D1 runtime removal',()=>{
  const start=core.indexOf("/api/admin/product-image-treatment/summary");
  const end=core.indexOf("const treatmentUpload",start);
  const block=core.slice(start,end);
  assert.ok(block.includes('supabaseProductTreatmentSummary'));
  assert.ok(block.includes('supabaseProductTreatmentQueue'));
  assert.ok(!block.includes('supabaseReadsRequested(env)'));
  assert.ok(!block.includes('preferSupabaseRead('));
  assert.ok(!block.includes('env.DB'));
});
