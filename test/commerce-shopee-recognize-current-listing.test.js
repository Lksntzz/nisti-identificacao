import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const link=fs.readFileSync('supabase/migrations/20261019195500_commerce_shopee_same_listing_owner.sql','utf8');
const candidate=fs.readFileSync('supabase/migrations/20261019203000_commerce_shopee_unlinked_candidate_variation.sql','utf8');
const panel=fs.readFileSync('src/commerce-shopee-unlinked-sales.jsx','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');

test('SKU duplicado pode reconhecer UM anúncio, sem atribuir à variação arbitrária',()=>{
  assert.match(link,/having count\(\*\)>1 and count\(distinct listing_id\)=1/);
  assert.match(link,/null::bigint listing_product_id/);
  assert.match(link,/null::text variation_id,'LISTING_ONLY'/);
  assert.match(link,/select \* from direct[\s\S]*union all select \* from reviewed[\s\S]*union all select \* from listing_only/);
  assert.match(link,/security_invoker=true/);
  assert.match(link,/from public,anon,authenticated/);
  assert.doesNotMatch(link,/update public\.commerce_sales_rows|delete from public\.commerce_sales_rows/);
});

test('no histórico mensal, variação da venda identifica Cabelo 6 sem duplicar Cabelo 5',()=>{
  assert.match(link,/coalesce\(u\.variation_id, vm\.variation_id\)/);
  assert.match(link,/lower\(btrim\(v\.name\)\)=lower\(btrim\(r\.variation\)\)/);
  assert.match(link,/having count\(\*\)=1/);
  assert.match(link,/and v\.sku=u\.canonical_sku/);
});

test('mudança de ano e acabamento apenas sugere anúncio ativo para revisão',()=>{
  assert.match(candidate,/possible_variation_id/);
  assert.match(candidate,/possible_external_listing_id/);
  assert.match(candidate,/having count\(\*\)=1/);
  assert.match(candidate,/public\.commerce_shopee_sku_owner_reviewed_v1 mapped/);
  assert.match(candidate,/revoke all on function public\.commerce_shopee_unlinked_sales_v1/);
  assert.doesNotMatch(candidate,/update public\.commerce_listing_products|update public\.commerce_sales_rows/);
});

test('dados aparecem sem pedir confirmação manual de SKU',()=>{
  assert.match(panel,/Vendas importadas pelo SKU/);
  assert.match(panel,/history_months/);
  assert.match(panel,/Histórico mensal/);
  assert.match(panel,/sku_norm/);
  assert.match(manager,/ShopeeUnlinkedSales days=\{days\}/);
  assert.doesNotMatch(panel,/variation_id:Number\(review\.possible_variation_id\)/);
  assert.doesNotMatch(manager,/reconciliationOpen|Conciliar SKUs Shopee/);
});
