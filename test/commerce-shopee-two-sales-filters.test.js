import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261020235000_commerce_shopee_two_filters_reconciled_v1.sql','utf8');

test('only Com vendas and Sem vendas are visible as listing status filters',()=>{
  assert.match(manager,/const SALES_FILTERS=\[\['SOLD','Com vendas'\],\['ZERO','Sem vendas'\]\]/);
  assert.match(manager,/const noSalesStatus='ZERO'/);
  assert.match(manager,/const noSalesValue=kpi\.zero_ads/);
  assert.match(manager,/const changeNoSales=\(\)=>change\(setStatus,status==='ZERO'\?'ALL':'ZERO'\)/);
  assert.doesNotMatch(manager,/Sem vínculo \(Shopee\)|Variações sem vendas\s*<\/button>/);
  assert.doesNotMatch(manager,/const shopeeUnlinkedView|Sem vendas identificadas':'Sem vendas/);
});

test('verification is by full imported period, reviewed unique SKU owner, no sale multiplication',()=>{
  assert.match(sql,/shopee_import_window as \(/);
  assert.match(sql,/count\(distinct d\.sale_date\)/);
  assert.match(sql,/sm\.period_start<=days\.day::date and sm\.period_end>=days\.day::date/);
  assert.match(sql,/shopee_sku_ownership as \(/);
  assert.match(sql,/owner\.listing_product_id=v\.id/);
  assert.match(sql,/owner\.source_sku_norm=v\.sku_norm/);
  assert.match(sql,/so\.total=so\.verified/);
  assert.match(sql,/sw\.sales_days>=b\.days and sw\.report_days>=b\.days/);
  assert.match(sql,/b\.selected_status='ZERO' and c\.ready and c\.units=0/);
  assert.match(sql,/count\(\*\) filter\(where source_code='SHOPEE' and ready and units>0\)::int shopee_covered_sold_ads/);
  assert.match(manager,/Number\(kpi\.shopee_covered_sold_ads\|\|0\)/);
});

test('variation details use verified data, ambiguous cases stay pending',()=>{
  assert.match(manager,/partial=\{hasShopeePartial&&item\.source==='SHOPEE'&&!item\.ready\}/);
  assert.match(manager,/\{item\.total_variations>0&&!complete&&/);
  assert.match(manager,/AUSÊNCIA|ausência de unidades|Ausência de venda|Ausência de venda significa/);
  assert.match(sql,/SECURITY INVOKER/);
  assert.doesNotMatch(sql,/\b(?:truncate|delete\s+from|update\s+public|insert\s+into\s+public)\b/i);
});
