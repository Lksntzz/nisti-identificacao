import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261022200000_commerce_evolution_observed_zeros_v2.sql','utf8');

test('backend keeps unassigned listing sales out of SKU zero counts',()=>{
  assert.match(sql,/a\.unlinked_30/);
  assert.match(sql,/a\.unsold_identified_variations>0/);
  assert.match(sql,/selling_ads_with_unsold_variations/);
});

test('backend preserves pagination and service-role-only read access',()=>{
  assert.match(sql,/limit \(select page_size from input\) offset \(select page_offset from input\)/);
  assert.match(sql,/revoke all on function public\.commerce_evolution_ads_v1/);
  assert.match(sql,/to service_role/);
  assert.match(sql,/daily as materialized/);
  assert.doesNotMatch(sql,/\b(?:truncate|delete from|insert into|update)\s+public\./i);
});
