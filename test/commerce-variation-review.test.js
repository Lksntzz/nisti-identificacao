import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261021194500_commerce_variation_review_partial_evidence_v1.sql','utf8');
const base=fs.readFileSync('supabase/migrations/20261021191500_commerce_variation_review_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');

test('variation analysis only uses real active listings, keyed by variation ID and unique SKU',()=>{
  for(const needle of ["l.listing_status='ACTIVE'","lp.relation_status<>'REMOVED'",
    'count(distinct variation_id)>1','count(*) over(partition by v.listing_id,v.norm)',
    'o.listing_product_id=v.listing_product_id','o.listing_id=v.listing_id',
    'o.canonical_sku_norm=v.norm','d.external_listing_id=v.external_listing_id']){
    assert.ok(sql.includes(needle),needle);
  }
  assert.match(sql,/from public\.commerce_shopee_sku_owner_reviewed_v1 o/);
  assert.match(sql,/commerce_current_sales_listing_daily_v1/);
  assert.match(sql,/sum\(d\.units\) filter/);
  assert.match(sql,/p_limit integer default 20/);
  assert.match(sql,/page_size/);
  assert.match(sql,/jsonb_agg/);
  assert.doesNotMatch(sql,/\b(?:update|delete from|insert into|truncate)\s+public\.commerce_/i);
});

test('new RPC is read-only, admin-only and uses a single bounded source of daily sales',()=>{
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/revoke all on function public\.commerce_variation_review_v1/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.match(base,/daily as materialized/);
  assert.match(store,/export async function commerceVariationReview/);
  assert.match(store,/commerce_variation_review_v1/);
  assert.match(store,/timeoutMs:15000/);
  assert.match(router,/BASE_PATH\+'\/listings\/manager\/variation-review'/);
  assert.match(router,/commerceVariationReview\(env,/);
  assert.match(router,/!\[30,60,90\]\.includes\(days\)/);
});
