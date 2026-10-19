import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261019174500_commerce_shopee_unlinked_sales_v1.sql','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const panel=fs.readFileSync('src/commerce-shopee-unlinked-sales.jsx','utf8');

test('relatório sem vínculo só lê vendas reais sem inventar dono ou SKU atual',()=>{
  assert.match(sql,/commerce_sales_rows r/);
  assert.match(sql,/commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current/);
  assert.match(sql,/commerce_shopee_sales_sku_daily_v1 d/);
  assert.match(sql,/commerce_shopee_sku_owner_reviewed_v1 mapped/);
  assert.match(sql,/where not exists \(select 1 from public\.commerce_shopee_sku_owner_reviewed_v1 mapped/);
  assert.match(sql,/r\.sku/);
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/(?:insert|update|delete)\s+(?:into\s+|from\s+)?public\.commerce_sales_rows/i);
});
test('filtros mensal e diários usam origem correta e excluem snapshot anterior',()=>{
  assert.match(sql,/b\.days=0 and r\.period_start=b\.first_month/);
  assert.match(sql,/max\(snapshot_id\) snapshot_id/);
  assert.match(sql,/latest\.snapshot_id=d\.snapshot_id/);
  assert.match(sql,/d\.sale_date between w\.period_start and w\.period_end/);
  assert.match(store,/commerce_shopee_unlinked_sales_v1/);
  assert.match(router,/listings\/manager\/shopee\/unlinked-sales/);
  assert.match(router,/\[0,7,30,60,90\]\.includes\(days\)/);
});
test('painel é separado de anúncios sem vendas e preserva SKU de venda',()=>{
  assert.match(manager,/Ver vendas sem vínculo/);
  assert.match(manager,/ShopeeUnlinkedSales/);
  assert.match(panel,/SKU da venda/);
  assert.match(panel,/SKU original não é alterado/);
  assert.match(panel,/Não representam todos os anúncios sem vendas vinculadas/);
  assert.match(panel,/original_available/);
  assert.match(panel,/money\(item\.revenue\)/);
  // O relatório só permite vincular após ação do administrador, justificativa e confirmação.
  assert.match(panel,/reconciliation\/approve/);
  assert.match(panel,/evidence\.trim\(\)\.length<8/);
  assert.match(panel,/confirmed:true/);
  assert.match(panel,/possible_variation_id/);
});
