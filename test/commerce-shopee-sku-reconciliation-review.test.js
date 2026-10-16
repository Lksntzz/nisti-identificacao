import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20261016191000_commerce_shopee_sales_sku_reconciliation_review_v1.sql','utf8');
const attribution=fs.readFileSync('supabase/migrations/20261016191100_commerce_shopee_reviewed_alias_sale_views_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const form=fs.readFileSync('src/commerce-shopee-reconciliation.jsx','utf8');
const css=fs.readFileSync('src/commerce-shopee-reconciliation.css','utf8');

test('fonte e destino de SKU têm validação dupla, sem alterar produtos',()=>{
  assert.match(migration,/create table if not exists public\.commerce_shopee_sales_sku_alias_reviews_v1/);
  assert.match(migration,/source_sku_norm text primary key/);
  assert.match(migration,/listing_product_id bigint not null references public\.commerce_listing_products/);
  assert.match(migration,/join public\.commerce_sales_snapshots sn on sn\.id=r\.snapshot_id and sn\.is_current/);
  assert.match(migration,/l\.listing_status='ACTIVE'/);
  assert.match(migration,/v_target_count<>1/);
  assert.match(migration,/v_source_count>0/);
  assert.match(migration,/SKU já confirmado para outra variação/);
  assert.match(migration,/p_confirmed is distinct from true/);
  assert.match(migration,/revoked_at=now\(\)/);
  assert.doesNotMatch(migration,/insert into public\.products|update public\.products|delete from public\.products|update public\.commerce_listing_products|update public\.commerce_sales_rows/);
});

test('nunca aprova automaticamente sugestão de prefixo 2026/2027',()=>{
  assert.match(migration,/when s\.sku~'\^PB\(25\|26\)'/);
  assert.match(migration,/when s\.sku~'\^AGMT\(25\|26\)'/);
  assert.match(migration,/when s\.sku~'\^PLAN\(25\|26\)'/);
  assert.match(migration,/having count\(\*\)=1/);
  assert.match(form,/Sugestão: anúncio/);
  assert.match(form,/setConfirmed\(false\)/);
  assert.match(form,/Confirmei que este SKU das vendas e a variação escolhida representam o mesmo produto/);
  assert.match(form,/evidence\.trim\(\)\.length<8/);
  assert.match(form,/sku:active\.sku,variation_id:Number\(variation\.variation_id\)/);
});

test('SKU duplicado no mesmo anúncio permanece pendente sem rateio por variação',()=>{
  assert.match(migration,/when coalesce\(o\.owners,0\)>1 then 'DUPLICATE_SKU'/);
  assert.match(form,/item\.status==='DUPLICATE_SKU'/);
  assert.match(form,/Requer ID de variação na origem/);
  assert.match(migration,/having count\(\*\)=1/);
});

test('associações aprovadas alimentam dias, meses e histórico pelo SKU canônico',()=>{
  assert.match(migration,/create or replace view public\.commerce_shopee_sku_owner_reviewed_v1/);
  assert.match(migration,/not exists \(\s*select 1 from variants used where used\.norm=a\.source_sku_norm/);
  assert.match(attribution,/o\.canonical_sku_norm as sku_norm/);
  assert.match(attribution,/o\.source_sku_norm=s\.sku_norm/);
  assert.match(attribution,/u\.canonical_sku as sku/);
  assert.match(attribution,/group by u\.listing_id,u\.variation_id,u\.canonical_sku/);
  assert.match(attribution,/from public\.commerce_shopee_sku_owner_reviewed_v1/);
  assert.match(attribution,/security_invoker=true/);
  assert.match(attribution,/bool_or\(c\.platform='SHOPEE'\) partial/);
});

test('rotas administrativas exigem seleção, justificativa e consentimento explícitos',()=>{
  assert.match(router,/listings\/manager\/shopee\/reconciliation/);
  assert.match(router,/body\?\.confirmed!==true/);
  assert.match(router,/operatorName\(request\)/);
  assert.match(router,/commerceShopeeSkuConfirm\(env/);
  assert.match(router,/commerceShopeeSkuRevoke\(env/);
  assert.match(store,/commerce_shopee_confirm_sku_alias_v1/);
  assert.match(store,/commerce_shopee_revoke_sku_alias_v1/);
  assert.match(store,/commerce_shopee_sku_candidate_search_v1/);
  assert.match(store,/commerce_shopee_sku_reconciliation_queue_v1/);
  assert.match(store,/input\.confirmed!==true/);
});

test('controle de banco isola a conciliação do usuário anônimo',()=>{
  assert.match(migration,/alter table public\.commerce_shopee_sales_sku_alias_reviews_v1 enable row level security/);
  assert.match(migration,/with \(security_invoker=true\)/);
  assert.match(migration,/security invoker set search_path=public/);
  assert.match(migration,/from public,anon,authenticated/);
  assert.match(migration,/to service_role/);
});

test('o Gestor exibe ferramenta contextual Shopee com paginação e revogação',()=>{
  assert.match(manager,/import ShopeeSkuReconciliation from/);
  assert.match(manager,/platform==='SHOPEE'&&reconciliationOpen/);
  assert.match(manager,/Conciliar SKUs Shopee/);
  assert.match(form,/const PAGE_SIZE=15/);
  assert.match(form,/aria-label="Situação dos SKUs"/);
  assert.match(form,/Pendentes/);
  assert.match(form,/Confirmados/);
  assert.match(form,/Pesquisar anúncio ativo ou SKU atual/);
  assert.match(form,/onChanged\?\.\(\)/);
  assert.match(form,/Confirmar revogação/);
  assert.match(css,/@media\(max-width:800px\)/);
  assert.match(css,/@media\(max-width:520px\)/);
});
