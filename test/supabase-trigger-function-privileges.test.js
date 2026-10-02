import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  'supabase/migrations/20261002015800_trigger_function_privileges_v1.sql',
  'utf8'
);

test('Commerce trigger helpers are not executable by public client roles',()=>{
  for(const name of [
    'commerce_nisti_link_apply_trigger_v1',
    'commerce_source_row_nisti_canonicalize_v1'
  ]){
    assert.match(sql,new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(\\)[\\s\\S]*FROM PUBLIC,anon,authenticated`));
    assert.match(sql,new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(\\)[\\s\\S]*TO service_role`));
  }
});

test('trigger privilege migration does not redefine trigger functions',()=>{
  assert.doesNotMatch(sql,/CREATE OR REPLACE FUNCTION/i);
  assert.doesNotMatch(sql,/SECURITY DEFINER/i);
});
