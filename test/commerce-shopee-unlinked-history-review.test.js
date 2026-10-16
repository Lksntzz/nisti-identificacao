import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261016210000_commerce_shopee_review_unlinked_history_v1.sql','utf8');
const ui=fs.readFileSync('src/commerce-shopee-reconciliation.jsx','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');

test('historical approval has no variation assignment and never edits products or sales',()=>{
  assert.match(sql,/create table if not exists public\.commerce_shopee_sales_history_reviews_v1/);
  assert.match(sql,/source_sku_norm text primary key/);
  assert.match(sql,/review_reason.*not null/);
  assert.match(sql,/NO_ACTIVE_LISTING/);
  assert.match(sql,/DUPLICATE_SKU/);
  assert.match(sql,/linked_units_added',0/);
  assert.doesNotMatch(sql,/insert into public\.commerce_shopee_sales_sku_alias_reviews|update public\.commerce_sales_rows|update public\.commerce_listing_products|update public\.products|delete from public\.products/);
  assert.doesNotMatch(sql,/listing_product_id bigint/);
});

test('records the imported quantity, revenue, end date and review reason for stale-change detection',()=>{
  assert.match(sql,/reviewed_units bigint not null/);
  assert.match(sql,/reviewed_revenue numeric\(18,2\) not null/);
  assert.match(sql,/reviewed_period_end date not null/);
  assert.match(sql,/h\.reviewed_units=s\.units/);
  assert.match(sql,/h\.reviewed_revenue=s\.revenue/);
  assert.match(sql,/h\.reviewed_period_end=s\.last_day/);
  assert.match(sql,/h\.review_reason=\(case when coalesce\(o\.owners,0\)>1/);
  assert.match(sql,/h\.active/);
});

test('queue separates pending, linked and historically approved, no fictitious units',()=>{
  assert.match(sql,/upper\(p_state\) in \('APPROVED','REVIEWED'\)/);
  assert.match(sql,/HISTORICAL_APPROVED/);
  assert.match(sql,/DUPLICATE_REVIEWED/);
  assert.match(sql,/status in \('DUPLICATE_SKU','MISSING_ACTIVE_SKU'\)/);
  assert.match(sql,/reviewed_skus/);
  assert.match(sql,/reviewed_units/);
  assert.match(sql,/approved_skus/);
  assert.match(ui,/Histórico validado · sem anúncio ativo/);
  assert.match(ui,/Histórico validado · SKU duplicado/);
  assert.match(ui,/Histórico validado/);
  assert.match(ui,/SKUs vinculados a anúncios/);
  assert.match(ui,/não comprova vendas por anúncio, ausência de vendas ou Curva ABC/);
});

test('admin-only RPC and endpoints demand explicit confirmation with reason',()=>{
  assert.match(sql,/alter table public\.commerce_shopee_sales_history_reviews_v1 enable row level security/);
  assert.match(sql,/revoke all on public\.commerce_shopee_sales_history_reviews_v1 from public,anon,authenticated/);
  assert.match(sql,/language plpgsql volatile security invoker/);
  assert.match(sql,/p_confirmed is distinct from true/);
  assert.match(sql,/revoke all on function public\.commerce_shopee_review_unlinked_history_v1/);
  assert.match(sql,/to service_role/);
  assert.match(router,/commerceShopeeReviewUnlinkedHistory/);
  assert.match(router,/commerceShopeeReopenUnlinkedHistory/);
  assert.match(router,/reconciliation\/history\/approve/);
  assert.match(router,/reconciliation\/history\/reopen/);
  assert.match(router,/body\?\.confirmed!==true/);
  assert.match(store,/commerce_shopee_review_unlinked_history_v1/);
  assert.match(store,/commerce_shopee_reopen_unlinked_history_v1/);
  assert.match(store,/filters\.state/);
});

test('reopening historical review is reversible and keeps original imported rows',()=>{
  assert.match(sql,/commerce_shopee_reopen_unlinked_history_v1/);
  assert.match(sql,/active=false,reopened_at=now\(\)/);
  assert.match(sql,/reopened_by/);
  assert.match(ui,/Confirmar reabertura/);
  assert.match(ui,/history\/reopen/);
  assert.match(sql,/where coalesce\(o\.owner_count,0\)<>1 and a\.source_sku_norm is null/);
  assert.match(sql,/on conflict\(source_sku_norm\) do update/);
  assert.match(sql,/pg_advisory_xact_lock/);
});
