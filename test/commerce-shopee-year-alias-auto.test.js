import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261016195500_commerce_shopee_auto_year_26_to_27_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const ui=fs.readFileSync('src/commerce-shopee-reconciliation.jsx','utf8');

test('automatic 26->27 rule is restricted to PB, PLAN and AGMT (never 25 or unrelated SKUs)',()=>{
  assert.match(sql,/\^PB26\[A-Z0-9\]\{3,\}\$/);
  assert.match(sql,/\^PLAN26\[A-Z0-9\]\{3,\}\$/);
  assert.match(sql,/\^AGMT26\[A-Z0-9\]\{3,\}\$/);
  assert.match(sql,/'PB27'\|\|substr\(source_sku,5\)/);
  assert.match(sql,/'PLAN27'\|\|substr\(source_sku,7\)/);
  assert.match(sql,/'AGMT27'\|\|substr\(source_sku,7\)/);
  assert.doesNotMatch(sql,/PB25|PLAN25|AGMT25|CONFIN27/);
});

test('matches the full normalized suffix, not just the middle or a product title',()=>{
  assert.match(sql,/public\.commerce_nisti_sku_norm_v1\(r\.sku_norm\) source_sku/);
  assert.match(sql,/public\.commerce_nisti_sku_norm_v1\(lp\.platform_sku\) sku_norm/);
  assert.match(sql,/join unique_targets u on u\.sku_norm=c\.target_sku/);
  assert.match(sql,/having count\(\*\)=1/);
  assert.match(sql,/not exists \(\s*select 1 from active_variations v where v\.sku_norm=c\.source_sku/);
  assert.doesNotMatch(sql,/lower\(.*title|similarity\(|levenshtein\(/);
});

test('never reinstate revoked aliases, replace manual links or change product/sales rows',()=>{
  assert.match(sql,/not exists \(\s*select 1 from public\.commerce_shopee_sales_sku_alias_reviews_v1 a/);
  assert.match(sql,/on conflict \(source_sku_norm\) do nothing/);
  assert.match(sql,/NISTI_AUTO_YEAR_26_27/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.doesNotMatch(sql,/update public\.products|delete from public\.products|update public\.commerce_listings|update public\.commerce_sales_rows/);
});

test('RLS/invoker execution is restricted to service_role and reuses reviewed reconciliation',()=>{
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/revoke all on function public\.commerce_shopee_auto_link_year26_v1\(\)/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.match(sql,/insert into public\.commerce_shopee_sales_sku_alias_reviews_v1/);
});

test('future sales and catalog imports reconcile on successful commits without disguising failures',()=>{
  assert.match(store,/async function refreshShopeeYearAliases\(env\)/);
  assert.match(store,/commerce_shopee_auto_link_year26_v1/);
  assert.match(store,/catch \(error\)/);
  assert.match(store,/A completed import must never be reported as failed/);
  assert.match(store,/export async function commerceCommitSalesImport/);
  assert.match(store,/String\(result\?\.status\|\|''\)\.toUpperCase\(\)==='COMMITTED'/);
  assert.match(store,/export async function commerceCommitImportBatch/);
  assert.match(store,/await refreshShopeeYearAliases\(env\)/);
});

test('the operator sees explicitly which associations were automatic and can revoke them',()=>{
  assert.match(ui,/item\.approved_by==='NISTI_AUTO_YEAR_26_27'/);
  assert.match(ui,/Ano 26 → 27 · automático/);
  assert.match(ui,/PB, PLAN, AGMT, CONFIN, VACMNO e VACMNA com ano 26 → 27/);
  assert.match(ui,/Vínculos a anúncios podem ser revogados e validações de histórico podem ser reabertas/);
  assert.match(ui,/Confirmar revogação/);
});
