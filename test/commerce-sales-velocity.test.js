import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = name => fs.readFileSync(name,'utf8');
const sql = read('supabase/migrations/20261016030000_commerce_sales_velocity_v1.sql');
const view = read('src/commerce-sales-velocity.jsx');
const css = read('src/commerce-sales-velocity.css');
const dashboard = read('src/commerce-commercial-dashboard.jsx');
const router = read('src/commerce-admin-router.js');
const store = read('src/commerce-supabase-store.js');

test('Painel Comercial displays four actionable sales statuses and 7/30/60/90-day filters',()=>{
  assert.match(dashboard,/CommerceSalesVelocity/);
  assert.match(dashboard,/<CommerceSalesVelocity platform=\{platform\}/);
  for(const n of [7,30,60,90])assert.match(view,new RegExp('\\b'+n+'\\b'));
  for(const label of ['Com vendas','Sem vendas','Poucas vendas','Em crescimento','Mês de referência'])
    assert.ok(view.includes(label),label);
  assert.match(view,/setActiveStatus\(metric\.code\)/);
  assert.match(view,/activeStatus===metric\.code/);
  assert.match(view,/setOffset\(v=>v\+15\)/);
  assert.match(view,/input type="month"/);
  assert.match(css,/\.nisti-vl-metrics/);
  assert.match(css,/@media\(max-width:560px\)/);
});

test('rolling windows require daily summary coverage per source, not monthly approximations',()=>{
  assert.match(sql,/p_days in \(7,30,60,90\)/);
  assert.match(sql,/r\.period_start=r\.period_end/);
  assert.match(sql,/s\.period_start=s\.period_end/);
  assert.match(sql,/expected_platforms as/);
  assert.match(sql,/source_coverage as/);
  assert.match(sql,/left join summaries s on s\.platform_code=e\.source_code/);
  assert.match(sql,/c\.current_days >= b\.days/);
  assert.match(sql,/c\.previous_days >= b\.days/);
  assert.match(sql,/'NO_IMPORT'/);
  assert.match(sql,/'DAILY_DATA_REQUIRED'/);
  assert.match(sql,/'GROWTH_HISTORY_REQUIRED'/);
  assert.match(view,/não permitem calcular corretamente 7, 30, 60 ou 90 dias/);
  assert.match(view,/Produtos sem dados não são classificados como/);
});

test('sales are consolidated per canonical SKU, without duplicating the revenue per seller listing',()=>{
  assert.match(sql,/public\.commerce_active_product_catalog_v1/);
  assert.match(sql,/public\.commerce_nisti_sku_norm_v1/);
  assert.match(sql,/from catalog_skus c where c\.sku_norm is not null/);
  assert.match(sql,/group by c\.sku_norm/);
  assert.match(sql,/jsonb_agg\(distinct ad\.value\)/);
  assert.match(sql,/from public\.commerce_sales_rows r/);
  assert.match(sql,/coalesce\(s\.current_units,0\)/);
  assert.match(sql,/'catalog_unidentified'/);
  assert.doesNotMatch(sql,/commerce_manual_listing_sales/);
  assert.doesNotMatch(sql,/insert into|update public\.commerce_sales_rows|delete from public\.products/i);
  assert.match(view,/Os números pertencem ao produto\/SKU, não a cada ID de anúncio/);
  assert.match(view,/Sem atribuição individual de vendas aos anúncios/);
});

test('low-performance is relative to average, and growth compares equal-length windows with >=20% and minimum 3 units',()=>{
  assert.match(sql,/avg\(current_units\)::numeric mean_positive_units/);
  assert.match(sql,/p\.current_units < coalesce\(a\.mean_positive_units,0\)/);
  assert.match(sql,/p\.current_units>=3/);
  assert.match(sql,/p\.current_units>=p\.previous_units\*1\.20/);
  assert.match(sql,/p\.previous_units=0/);
  assert.match(sql,/requested_end - days as previous_end/);
  assert.match(sql,/requested_end - \(2\*days-1\) as previous_start/);
  assert.match(view,/pelo menos 3 unidades e aumento de 20%/);
});

test('filter endpoint validates supported time range and does not touch Scanner writes',()=>{
  assert.match(router,/\/sales\/velocity/);
  assert.match(router,/\[7,30,60,90\]\.includes\(days\)/);
  assert.match(router,/commerceSalesVelocity\(env/);
  assert.match(store,/commerce_sales_velocity_v1/);
  assert.match(sql,/to service_role/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.doesNotMatch(sql,/insert into public\.products|delete from public\.product_gtins/i);
});
