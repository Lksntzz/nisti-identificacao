import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20261022170000_commerce_evolution_all_active_sales_v2.sql','utf8');
const guard=fs.readFileSync('supabase/migrations/20261022173000_commerce_evolution_zero_guard_v1.sql','utf8');
const salesFirst=fs.readFileSync('supabase/migrations/20261022175000_commerce_evolution_sales_first_v1.sql','utf8');

test('all active marketplace ads are eligible regardless of number of variations',()=>{
  assert.match(migration,/where l\.listing_status='ACTIVE'/);
  assert.match(migration,/left join public\.commerce_listing_products lp/);
  assert.doesNotMatch(migration,/multi_listing as \(/);
  assert.doesNotMatch(migration,/having count\(distinct variation_id\)>1/);
  assert.doesNotMatch(migration,/and nullif\(lp\.variation_id,''\) is not null/);
  assert.match(migration,/count\(v\.listing_product_id\)::int variation_count/);
});

test('sales identified by advertisement ID are not assigned to arbitrary variation',()=>{
  assert.match(migration,/ad_daily as \(/);
  assert.match(migration,/d\.external_listing_id=l\.external_listing_id/);
  assert.match(migration,/greatest\(0,coalesce\(ad\.total_90,0\)-coalesce\(sum\(v\.actual_90\) filter\(where v\.match_verified\),0\)\) unlinked_90/);
  assert.match(migration,/when v\.sku is null or nullif\(v\.norm,''\) is null then 'MISSING_SKU'/);
  assert.match(migration,/v\.match_verified and \(v\.complete_90 or v\.actual_90>0\)/);
  assert.match(migration,/bool_and\(v\.complete_90\)/);
  assert.match(migration,/sum\(v\.units_90\)=coalesce\(ad\.total_90,0\)/);
});

test('show actual product revenue and evidence limits for each 30 60 90 window',()=>{
  for(const d of [30,60,90]){
    assert.match(migration,new RegExp('revenue_'+d));
    assert.match(migration,new RegExp('identified_'+d));
  }
});

test('reconciliation query uses read-only service role access and bounded pagination',()=>{
  assert.match(migration,/greatest\(1,least\(coalesce\(p_limit,20\),50\)\)/);
  assert.match(migration,/daily as materialized/);
  assert.match(migration,/revoke all on function public\.commerce_evolution_ads_v1/);
  assert.match(migration,/to service_role/);
  assert.doesNotMatch(migration,/\b(?:update|delete from|insert into|truncate)\s+public\./i);
});

test('zero-sales classification cannot include ads with unmatched but identified sales',()=>{
  assert.match(guard,/then 0\s+else count\(\*\) filter\(where/);
  assert.match(guard,/then count\(\*\) filter\(where \(/);
  assert.match(guard,/unknown_variations/);
});

test('default page displays actual selling listings first while status filter stays enforced',()=>{
  assert.match(salesFirst,/order by \(case \(select days from input\)/);
  assert.match(salesFirst,/a\.identified_90 end\) desc/);
  assert.match(salesFirst,/and \(i\.status='ALL' or a\.situation=i\.status\)/);
  assert.match(salesFirst,/limit \(select page_size from input\) offset \(select page_offset from input\)/);
});
