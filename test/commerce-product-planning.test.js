import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync(new URL('../src/commerce-products-view.jsx',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/commerce-admin-router.js',import.meta.url),'utf8');
const store=fs.readFileSync(new URL('../src/commerce-supabase-store.js',import.meta.url),'utf8');
const sales=fs.readFileSync(new URL('../supabase/migrations/20261013140500_commerce_product_sales_planning_v1.sql',import.meta.url),'utf8');
const presence=fs.readFileSync(new URL('../supabase/migrations/20261013140000_commerce_product_planning_v1.sql',import.meta.url),'utf8');

test('planning is loaded by current product ids without cross-platform aggregation',()=>{
  assert.match(ui,/products\/sales-planning\?/);
  assert.match(ui,/ids:ids\.join\(','\)/);
  assert.match(ui,/platform:marketplace \|\| 'TODAS'/);
  assert.match(ui,/report\.month_units/);
  assert.match(ui,/report\.month_projection/);
  assert.match(ui,/report\.daily_average/);
  assert.match(ui,/historic_monthly_average/);
  assert.match(router,/commerceProductSalesPlanning/);
  assert.match(store,/commerce_product_sales_planning_v1/);
});

test('exclusive and shared filtering happens before pagination in Postgres',()=>{
  assert.match(ui,/value="EXCLUSIVE"/);
  assert.match(ui,/value="SHARED"/);
  assert.match(router,/presence: query\(url, 'presence'\)/);
  assert.match(store,/commerce_list_products_planning_cards_v1/);
  assert.match(presence,/a\.marketplace_count = 1/);
  assert.match(presence,/a\.marketplace_count > 1/);
  assert.ok(presence.indexOf("from aggregated a") < presence.indexOf("count(*) over()"));
});

test('history excludes unimported periods and respects source platform',()=>{
  assert.match(sales,/commerce_sales_summary_rows/);
  assert.match(sales,/commerce_sales_snapshots/);
  assert.match(sales,/s\.is_current=true/);
  assert.match(sales,/commerce_sales_rows/);
  assert.match(sales,/p\.platform='MERCADO_LIVRE' and r\.platform_code in/);
  assert.match(sales,/max\(m\.units\) filter\(where m\.month=p\.current_month\)/);
  assert.match(sales,/count\(m\.month\) filter\(where m\.month<p\.current_month\)/);
  assert.match(sales,/p_months integer default 3/);
  assert.match(sales,/to_char\(m\.month,'YYYY-MM'\)/);
  assert.match(sales,/to service_role/);
});
