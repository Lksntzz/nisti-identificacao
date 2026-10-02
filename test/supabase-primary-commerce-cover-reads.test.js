import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const commerce=fs.readFileSync('src/nisti-commerce-sync.js','utf8');
const cleanup=fs.readFileSync('supabase/migrations/20261002115500_remove_ai_recognition_legacy.sql','utf8');

test('commerce synchronization sources NISTI products from Supabase when reads are enabled',()=>{
  assert.match(commerce,/supabaseReadsRequested\(env\)/);
  assert.match(commerce,/supabaseReserveProducts\(env\)/);
  const start=commerce.indexOf('async function loadNistiProducts');
  const d1=commerce.indexOf('env.DB.prepare',start);
  const primary=commerce.indexOf('if (supabaseReadsRequested(env))',start);
  assert.ok(primary>=0 && d1>primary);
});

test('legacy cover training RPCs are explicitly removed by the cleanup migration',()=>{
  for(const name of ['nisti_trained_references_v1','nisti_cover_index_v1','nisti_list_cover_references_v1']) {
    assert.match(cleanup,new RegExp(name));
  }
});
