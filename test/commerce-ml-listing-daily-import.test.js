import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(path,'utf8');
const sql = read('supabase/migrations/20261016050000_commerce_sales_listing_daily_v1.sql');
const abc = read('supabase/migrations/20261016051000_commerce_abc_listing_import_performance.sql');
const store = read('src/commerce-supabase-store.js');
const router = read('src/commerce-admin-router.js');
const importer = read('src/commerce-import-client.js');
const reader = read('src/commerce-ml-native-sales-reader.js');
const ui = read('src/commerce-abc-ad-performance.jsx');

test('daily sales by ID persist only aggregate fields and are readable only by service role',()=>{
  assert.match(sql,/commerce_sales_listing_daily_v1/);
  assert.match(sql,/batch_id bigint not null references public\.commerce_sales_import_batches/);
  assert.match(sql,/primary key\(batch_id,sale_date,external_listing_id,sku_norm\)/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on public\.commerce_sales_listing_daily_v1 from public,anon,authenticated/);
  assert.match(sql,/grant select,insert,update,delete on public\.commerce_sales_listing_daily_v1 to service_role/);
  assert.doesNotMatch(sql,/cpf|buyer|customer_id|shipping_address|tracking_number/i);
});

test('replacement sales use last COMMITTED daily report for each platform/day',()=>{
  assert.match(sql,/where b\.status='COMMITTED'/);
  assert.match(sql,/distinct on \(b\.platform_code,s\.period_start\)/);
  assert.match(sql,/s\.period_start=s\.period_end/);
  assert.match(sql,/order by b\.platform_code,s\.period_start,b\.committed_at desc,b\.id desc/);
  assert.match(sql,/on conflict\(batch_id,sale_date,external_listing_id,sku_norm\) do update set/);
});

test('browser stages listing totals before committing the normalized sales snapshot',()=>{
  assert.match(reader,/const listing_rows=/);
  assert.match(reader,/listing_rows,/);
  assert.match(importer,/const listingRows = Array\.isArray\(parsedWorkbook\?\.listing_rows\)/);
  assert.match(importer,/sales\/imports\/\$\{batchId\}\/listing-daily/);
  assert.ok(importer.indexOf('/listing-daily')<importer.indexOf("/commit',"));
  assert.match(router,/salesImportRowsMatch/);
  assert.match(router,/sellerDailyMatch/);
  assert.match(router,/commerceAppendSalesListingDaily\(env,batchId,body\.rows\)/);
  assert.match(store,/commerce_append_sales_listing_daily_v1/);
});

test('ABC ad details prefer verified imported values; manual values remain separately labelled',()=>{
  assert.match(abc,/public\.commerce_current_sales_listing_daily_v1 s/);
  assert.match(abc,/'imported_units',imported_units/);
  assert.match(abc,/'imported_revenue',imported_revenue/);
  assert.match(ui,/hasImportedUnits/);
  assert.match(ui,/item\.imported_units/);
  assert.match(ui,/item\.imported_revenue/);
  assert.match(ui,/Vendas importadas por ID de anúncio/);
  assert.match(ui,/registro manual separado/);
  assert.doesNotMatch(ui,/fmtMoney\(item\.imported_revenue\+item\.manual_units\)/);
});
