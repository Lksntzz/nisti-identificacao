import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261022190000_commerce_evolution_zero_observed_filter_v1.sql','utf8');
const view=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-integrated.css','utf8');

test('Sem vendas includes ads with zero sales identified and ads with zero-observed verified variants',()=>{
  assert.match(sql,/unsold_identified_variations/);
  assert.match(sql,/v\.listing_product_id is not null and v\.match_verified/);
  assert.match(sql,/i\.status='ZERO' and \(/);
  assert.match(sql,/a\.unsold_identified_variations>0/);
  assert.match(sql,/a\.identified_30 when 60 then a\.identified_60/);
  assert.match(sql,/'confirmed_zero',\(select count\(\*\) from classified where situation='ZERO'\)/);
  assert.match(sql,/'zero',\(select count\(\*\) from classified a cross join input i where/);
  assert.match(sql,/a\.variation_count>0 and a\.unknown_variations=0/);
});

test('the filter shows zero-observed variations without calling them confirmed zero',()=>{
  assert.match(view,/focusWithoutSales=\{status==='ZERO'\}/);
  assert.match(view,/Number\(v\['identified_'\+days\]\)===0/);
  assert.match(view,/Sem venda identificada/);
  assert.match(view,/kpis\.no_sales_ads/);
  assert.match(view,/kpis\.selling_ads_with_unsold_variations/);
  assert.match(view,/recordedUnits\(ad,n\)/);
  assert.match(view,/verifiedUnsoldVariations\(ad,days\)/);
  assert.match(view,/Anúncios ou variações sem vendas identificadas/);
  assert.match(view,/Anúncio com 0 vendas registradas/);
  assert.match(css,/\.nei-zero-filter-notice/);
});

test('database query remains service-only, read-only and paginated',()=>{
  assert.match(sql,/daily as materialized/);
  assert.match(sql,/greatest\(1,least\(coalesce\(p_limit,20\),50\)\)/);
  assert.match(sql,/revoke all on function public\.commerce_evolution_ads_v1/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/\b(?:delete from|insert into|truncate|update)\s+public\./i);
  assert.match(sql,/limit \(select page_size from input\) offset \(select page_offset from input\)/);
});
