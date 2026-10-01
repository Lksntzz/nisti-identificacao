import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const vectorize=fs.readFileSync('src/vectorize-admin-router.js','utf8');
const observability=fs.readFileSync('src/geometric-shadow-observability-router.js','utf8');
const benchmarkFiles=[
  'src/geometric-shadow-manifest.js',
  'src/retrieval-benchmark.js',
  'src/retrieval-consensus-benchmark.js',
  'src/retrieval-recall-benchmark.js'
].map(file=>fs.readFileSync(file,'utf8'));
const vectorSql=fs.readFileSync('supabase/migrations/20261001253000_primary_vectorize_admin_reads_v1.sql','utf8');
const observabilitySql=fs.readFileSync('supabase/migrations/20261001254000_primary_geometric_observability_v1.sql','utf8');
const benchmarkSql=fs.readFileSync('supabase/migrations/20261001255000_primary_benchmark_samples_v1.sql','utf8');

test('Vectorize admin reads are Supabase-primary aware',()=>{
  for(const name of [
    'nisti_vectorize_reference_rows_v1',
    'nisti_vectorize_reference_v1',
    'nisti_active_reference_ids_for_product_v1',
    'nisti_vectorize_status_v1'
  ]) assert.ok(vectorize.includes(name));
  assert.match(vectorize,/supabaseReadsRequested\(env\)/);
});

test('geometric observability reads Supabase when enabled',()=>{
  assert.match(observability,/nisti_geometric_shadow_observability_v1/);
  assert.match(observability,/supabaseReadsRequested\(env\)/);
  assert.match(observability,/Banco operacional não configurado/);
});

test('admin benchmark sample readers use one Supabase authority RPC',()=>{
  for(const source of benchmarkFiles){
    assert.match(source,/nisti_benchmark_samples_v1/);
    assert.match(source,/supabaseReadsRequested\(env\)/);
    assert.match(source,/!env\?\.DB && !supabaseReadsRequested\(env\)/);
  }
});

test('new admin read RPCs are invoker-only and service-role-only',()=>{
  for(const [source,names] of [
    [vectorSql,[
      'nisti_vectorize_reference_rows_v1',
      'nisti_vectorize_reference_v1',
      'nisti_active_reference_ids_for_product_v1',
      'nisti_vectorize_status_v1'
    ]],
    [observabilitySql,['nisti_geometric_shadow_observability_v1']],
    [benchmarkSql,['nisti_benchmark_samples_v1']]
  ]){
    assert.doesNotMatch(source,/SECURITY DEFINER/i);
    for(const name of names){
      assert.match(source,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
      assert.match(source,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
    }
  }
});
