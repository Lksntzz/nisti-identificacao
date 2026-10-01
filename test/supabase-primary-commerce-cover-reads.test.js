import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const commerce=fs.readFileSync('src/nisti-commerce-sync.js','utf8');
const core=fs.readFileSync('src/core-router.js','utf8');
const sql=fs.readFileSync('supabase/migrations/20261001251000_primary_cover_admin_reads_v1.sql','utf8');

test('commerce synchronization sources NISTI products from Supabase when reads are enabled',()=>{
  assert.match(commerce,/supabaseReadsRequested\(env\)/);
  assert.match(commerce,/supabaseReserveProducts\(env\)/);
  const start=commerce.indexOf('async function loadNistiProducts');
  const d1=commerce.indexOf('env.DB.prepare',start);
  const primary=commerce.indexOf('if (supabaseReadsRequested(env))',start);
  assert.ok(primary>=0 && d1>primary);
});

test('cover training diagnostics use Supabase read RPCs',()=>{
  assert.match(core,/nisti_trained_references_v1/);
  assert.match(core,/nisti_cover_index_v1/);
  assert.match(core,/supabaseReadsRequested\(env\)/);
});

test('cover admin read RPCs are server-only invoker functions',()=>{
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
  for(const name of ['nisti_trained_references_v1','nisti_cover_index_v1']){
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(`));
  }
});
