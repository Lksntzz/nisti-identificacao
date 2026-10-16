import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261017001000_commerce_shopee_finance_recovery_v1.sql','utf8');
const foundation=fs.readFileSync('supabase/migrations/20261016235500_commerce_shopee_financial_sales_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const client=fs.readFileSync('src/commerce-import-client.js','utf8');
const panel=fs.readFileSync('src/commerce-sales-import-panel.jsx','utf8');

test('finance reprocessing requires the exact filename and SHA of a previously COMMITTED Shopee sale file',()=>{
  assert.match(sql,/commerce_shopee_finance_backfill_source_v1/);
  assert.match(sql,/b\.source_filename=p_filename/);
  assert.match(sql,/b\.source_sha256=p_sha256 and length\(p_sha256\)=64/);
  assert.match(sql,/b\.status='COMMITTED'/);
  assert.match(sql,/source_sha256\)=lower\(p_source_sha256\)/);
  assert.match(foundation,/b\.status='COMMITTED' and length\(coalesce\(p_source_sha256,''\)\)=64/);
});

test('multipart month must have all parts, with same SKU revenue and order totals as current snapshot',()=>{
  assert.match(sql,/WAITING_PARTS/);
  assert.match(sql,/parts_received/);
  assert.match(sql,/parts_expected/);
  assert.match(sql,/select distinct on\(part\) id,part/);
  assert.match(sql,/date_trunc\('month',r\.period_start\)::date=v_month/);
  assert.match(sql,/v_actual_units is distinct from v_units/);
  assert.match(sql,/v_actual_orders is distinct from v_orders/);
  assert.match(sql,/Atribuição financeira incompleta/);
  assert.match(sql,/A planilha é anterior ao arquivo/);
});

test('historical fee recovery cannot reimport sales or change Scanner products',()=>{
  assert.doesNotMatch(sql,/update public\.commerce_sales_rows|insert into public\.commerce_sales_rows|delete from public\.commerce_sales_rows/);
  assert.doesNotMatch(sql,/update public\.products|insert into public\.products|delete from public\.products/);
  assert.match(sql,/sales_rows_modified',false/);
  assert.match(sql,/source_snapshot_id/);
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.match(sql,/to service_role/);
});

test('the finance only import stages fees and activates without sales commit',()=>{
  assert.match(client,/export async function reprocessShopeeSalesFinance/);
  const section=client.slice(client.indexOf('export async function reprocessShopeeSalesFinance'));
  assert.match(section,/sales\/finance\/source/);
  assert.match(section,/sales\/finance\/activate/);
  assert.match(section,/finance-month/);
  assert.match(section,/finance-daily/);
  assert.doesNotMatch(section,/sales\/imports\/\$\{batchId\}\/commit/);
  assert.match(store,/commerce_shopee_finance_backfill_source_v1/);
  assert.match(store,/commerce_shopee_finance_backfill_activate_v1/);
  assert.match(router,/commerceShopeeFinanceBackfillSource/);
  assert.match(router,/commerceShopeeFinanceBackfillActivate/);
  assert.match(panel,/Recuperar só taxas/);
  assert.match(panel,/sem modificar unidades nem pedidos/);
  assert.match(panel,/onClick=\{handleFinanceReprocess\}/);
  assert.match(panel,/FINANCE_NOT_IN_SOURCE|COMMITTED|WAITING_PARTS/);
});
