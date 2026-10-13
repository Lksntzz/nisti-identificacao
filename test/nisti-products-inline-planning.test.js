import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const catalog=fs.readFileSync(new URL('../src/admin/CatalogView.jsx',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/commerce-admin-router.js',import.meta.url),'utf8');
const sql=fs.readFileSync(new URL('../supabase/migrations/20261013150000_nisti_products_sales_planning_v1.sql',import.meta.url),'utf8');
test('real NISTI products panel renders planning metrics rather than hidden commercial view',()=>{
  assert.match(catalog,/products\/nisti-sales-planning/);
  assert.match(catalog,/VENDAS E PROJEÇÃO/);
  assert.match(catalog,/report\.month_units/);
  assert.match(catalog,/report\.daily_average/);
  assert.match(catalog,/report\.month_projection/);
  assert.match(catalog,/historic_monthly_average/);
  assert.match(catalog,/presenceFilter === 'EXCLUSIVE'/);
  assert.match(catalog,/historyMonths/);
});
test('NISTI product ids use explicit commerce links and server-authenticated endpoint',()=>{
  assert.match(router,/nistiProductsSalesPlanning/);
  assert.match(sql,/commerce_nisti_product_links/);
  assert.match(sql,/nisti_product_id/);
  assert.match(sql,/commerce_product_sales_planning_v1/);
  assert.match(sql,/grant execute.*to service_role/i);
});