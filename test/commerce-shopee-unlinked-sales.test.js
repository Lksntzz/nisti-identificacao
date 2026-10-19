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
test('cards de vendas aparecem automaticamente, sem associação de SKU',()=>{
  assert.match(manager,/ShopeeUnlinkedSales days=\{days\}/);
  assert.match(manager,/platform==='SHOPEE'/);
  assert.doesNotMatch(manager,/Conciliar SKUs Shopee|reconciliationOpen|unlinkedOpen/);
  assert.match(panel,/Vendas importadas pelo SKU/);
  assert.match(panel,/nim-model-sale-card/);
  assert.match(panel,/item\.sku\|\|item\.sku_norm/);
  assert.match(panel,/number\(item\.units\)/);
  assert.match(panel,/money\(item\.revenue\)/);
  assert.match(panel,/history_months/);
  assert.match(panel,/history\.map\(m=>/);
  assert.doesNotMatch(panel,/reconciliation\/approve|confirmed:true|Revisar associação/);
});
