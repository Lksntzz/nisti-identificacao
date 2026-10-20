import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('supabase/migrations/20261019195000_commerce_imported_sales_ml_daily_history.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');

test('totais diários somam pedidos importados ML e todos SKUs Shopee sem filtrar anúncios ativos',()=>{
  assert.match(source,/commerce_shopee_sales_sku_daily_v1 d/);
  assert.match(source,/commerce_sales_import_stage_summary s/);
  assert.match(source,/commerce_sales_import_batches b/);
  assert.match(source,/row_number\(\) over\(partition by b.platform_code,s.period_start/);
  assert.match(source,/group by d.sale_date/);
  assert.match(source,/v.snapshot_id=b.snapshot_id/);
  assert.doesNotMatch(source,/commerce_shopee_sku_owner_reviewed_v1|commerce_listings|commerce_listing_products/);
  assert.match(source,/sn.id=r.snapshot_id and sn.is_current/);
  assert.match(source,/where p.monthly and r.platform_code in/);
});
test('painel principal apresenta bruto, inclusive SKU ou anúncio inativo',()=>{
  assert.match(ui,/fullImportedAvailable=Boolean\(verifiedImportedTotals\)/);
  assert.match(ui,/fullImportedAvailable\?num\(verifiedImportedTotals.units\)/);
  assert.match(ui,/fullImportedAvailable\?money\(verifiedImportedTotals.revenue\)/);
  assert.match(ui,/Totais completos não disponíveis nesta consulta/);
  assert.match(ui,/Todas as unidades importadas no período, inclusive sem anúncio ativo/);
  assert.doesNotMatch(ui,/nim-total-source-row|importedTotals\.sources/);
  assert.doesNotMatch(ui,/nim-order-strip/);
  assert.match(ui,/label=\{fullImportedAvailable\?'Unidades vendidas'/);
  assert.match(ui,/label=\{fullImportedAvailable\?'Faturamento bruto importado'/);
  assert.match(ui,/data.period_start,end:data.period_end/);
  assert.match(ui,/monthly:days===0\?'1':'0'/);
});
test('rota importa apenas via admin com períodos validados',()=>{
  assert.match(router,/listings\/manager\/imported-totals/);
  assert.match(router,/commerceImportedSalesTotals\(env/);
  assert.match(router,/diff<0\|\|diff>90/);
  assert.match(store,/commerce_imported_sales_totals_v1/);
  assert.match(source,/security invoker set search_path=public/);
  assert.match(source,/from public,anon,authenticated/);
  assert.match(source,/to service_role/);
  assert.doesNotMatch(source,/(?:insert into|update|delete from)\s+public\.commerce_sales_/i);
});
