import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const reader=fs.readFileSync('src/commerce-sales-import-reader.js','utf8');
const client=fs.readFileSync('src/commerce-import-client.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const db=fs.readFileSync('supabase/migrations/20261016182500_commerce_shopee_daily_sku_source.sql','utf8');
const manager=fs.readFileSync('supabase/migrations/20261016183000_commerce_listing_manager_identified_daily.sql','utf8');
const history=fs.readFileSync('supabase/migrations/20261016183500_commerce_shopee_history_partial_flag.sql','utf8');

test('Shopee stores only real order dates, with totals per dated SKU and distinct order IDs',()=>{
  assert.match(reader,/sale_date_verified: Boolean\(date\)/);
  assert.match(reader,/if \(!item\.sale_date_verified \|\| !item\.sku_norm\) continue/);
  assert.match(reader,/const key = item\.sale_date \+ '\|' \+ item\.sku_norm/);
  assert.match(reader,/group\.orders\.add\(item\.order_id\)/);
  assert.match(reader,/orders_with_item: group\.orders\.size/);
  assert.match(reader,/sku_daily_rows,/);
  assert.match(reader,/resolveShopeeSalesColumns/);
  assert.match(reader,/isConfirmedShopeeOrder/);
});

test('daily SKU rows are staged before commit; batch mutations require admin API',()=>{
  assert.match(client,/const dailySkuRows = Array\.isArray\(parsedWorkbook\?\.sku_daily_rows\)/);
  assert.match(client,/if \(parsedWorkbook\.platform_code === 'SHOPEE' && dailySkuRows\.length\)/);
  assert.match(client,/sales\/imports\/\$\{batchId\}\/sku-daily/);
  assert.ok(client.indexOf("phase:'daily-sku'")<client.indexOf("phase: 'commit'"));
  assert.match(router,/sku-daily\$\//);
  assert.match(router,/commerceAppendShopeeDailySku\(env,batchId,body\.rows\)/);
  assert.match(store,/commerce_append_shopee_sku_daily_v1/);
  assert.match(db,/where id=p_batch_id for update/);
  assert.match(db,/v_platform is distinct from 'SHOPEE'/);
  assert.match(db,/v_status not in \('UPLOADED','STAGED'\)/);
  assert.match(db,/on conflict\(batch_id,sale_date,sku_norm\) do update/);
});

test('only globally unique active Shopee variation SKU can link a real sale to an ad',()=>{
  assert.match(db,/commerce_shopee_sales_sku_daily_v1/);
  assert.match(db,/m\.code='SHOPEE' and l\.listing_status='ACTIVE'/);
  assert.match(db,/lp\.relation_status<>'REMOVED'/);
  assert.match(db,/having count\(\*\)=1/);
  assert.match(db,/n\.platform_code='SHOPEE' and n\.sale_date=s\.sale_date/);
  assert.match(db,/max\(snapshot_id\) snapshot_id/);
  assert.match(db,/security_invoker=true/);
  assert.match(db,/enable row level security/);
  assert.match(db,/from public,anon,authenticated/);
  assert.match(db,/to service_role/);
});

test('rolling 7/30/60/90 periods are actual dated sales; zero and ABC require full coverage',()=>{
  assert.match(manager,/d\.sale_date between b\.period_start and b\.period_end/);
  assert.match(manager,/c\.source_code='SHOPEE' and c\.identified_units>0/);
  assert.match(manager,/b\.selected_status='ZERO' and c\.ready/);
  assert.match(manager,/dc\.current_days>=b\.days ready/);
  assert.match(manager,/then l\.units::numeric else l\.revenue/);
  assert.match(manager,/'source_kind',case when \(select platform from input\)='SHOPEE'/);
  assert.match(manager,/DAILY_SKU_PARTIAL/);
  assert.match(manager,/'identified_units',p\.identified_units/);
  assert.match(manager,/'identified_variations',coalesce\(p\.identified_variations/);
  assert.doesNotMatch(manager,/insert into public\.products|update public\.products|delete from public\.products/);
});

test('UI distinguishes linked values from gross totals without false zeros or fabricated tickets',()=>{
  assert.match(ui,/const hasDailyPartial=data\?\.source_kind==='DAILY_SKU_PARTIAL'/);
  assert.match(ui,/shopeeTotals\?\.units!=null\?num\(shopeeTotals\.units\)/);
  assert.match(ui,/shopeeTotals\?\.revenue!=null\?money\(shopeeTotals\.revenue\)/);
  assert.match(ui,/hasShopeePartial&&code==='ZERO'/);
  assert.match(ui,/hasShopeePartial&&code!=='ALL'/);
  assert.match(ui,/const dailyLinked=detailDays!==0&&Number\(detail\?\.identified_units\)>0/);
  assert.match(ui,/const partialVars=item\.source==='SHOPEE'&&!complete\?variationEvidence\.variations:\[\]/);
  assert.match(ui,/label="Pedidos com item"/);
  assert.match(ui,/order_item_incidents==null\?'—':num\(ordersMetrics\.listing\.order_item_incidents\)/);
  assert.match(ui,/label="Receita por pedido com item"/);
  assert.match(ui,/reference_per_item_order==null\?'—':money\(ordersMetrics\.listing\.reference_per_item_order\)/);
  assert.match(ui,/não ticket médio exato do anúncio/);
});

test('monthly history flags real-date Shopee SKU associations as partial',()=>{
  assert.match(history,/bool_or\(c\.platform='SHOPEE'\) partial/);
  assert.match(history,/from public,anon,authenticated/);
  assert.match(history,/to service_role/);
});
