import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { adTrend } from '../src/commerce-evolution-helpers.js';

const sql=fs.readFileSync('supabase/migrations/20261022220000_commerce_evolution_trends_from_imported_ads_v1.sql','utf8');

test('trend uses sales directly linked to the advertisement in equal-length windows',()=>{
  assert.match(sql,/d\.external_listing_id=l\.external_listing_id/);
  assert.match(sql,/c\.end_date-\(i\.days-1\) and c\.end_date/);
  assert.match(sql,/c\.end_date-\(2\*i\.days-1\) and c\.end_date-i\.days/);
  assert.match(sql,/max\(ad\.current_window_units\)::bigint current_window_units/);
  assert.match(sql,/max\(ad\.previous_window_units\)::bigint previous_window_units/);
  assert.match(sql,/a\.previous_window_units>=3/);
  assert.match(sql,/a\.current_window_units-a\.previous_window_units>=2/);
  assert.match(sql,/a\.current_window_units>=a\.previous_window_units\*1\.2 then 'RISING'/);
  assert.match(sql,/a\.current_window_units>0 then 'STABLE'/);
  assert.doesNotMatch(sql,/a\.unknown_variations=0 and a\.previous_unknown=0 and a\.previous_units>=3/);
});

test('does not damage no-sales listing or variation classification',()=>{
  assert.match(sql,/a\.unsold_identified_variations>0/);
  assert.match(sql,/'no_sales_ads'/);
  assert.match(sql,/'selling_ads_with_unsold_variations'/);
  assert.match(sql,/a\.unlinked_30/);
  assert.match(sql,/status='ZERO'/);
  assert.match(sql,/limit \(select page_size from input\) offset \(select page_offset from input\)/);
});

test('reuses one bounded read-only sales ledger scan',()=>{
  assert.match(sql,/daily as materialized/);
  assert.match(sql,/greatest\(89,2\*i\.days-1\)/);
  assert.match(sql,/greatest\(1,least\(coalesce\(p_limit,20\),50\)\)/);
  assert.match(sql,/revoke all on function public\.commerce_evolution_ads_v1/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/\b(?:update|delete from|insert into|truncate)\s+public\./i);
});

test('shows previous and current units plus precise deltas on stable and rising ads',()=>{
  const safari=adTrend({current_window_units:1145,previous_window_units:1123});
  assert.equal(safari.delta,22);
  assert.equal(safari.percent,2);
  const growth=adTrend({current_window_units:506,previous_window_units:376});
  assert.equal(growth.delta,130);
  assert.equal(growth.percent,34.6);
  assert.equal(adTrend({current_window_units:null,previous_window_units:5}),null);
});
