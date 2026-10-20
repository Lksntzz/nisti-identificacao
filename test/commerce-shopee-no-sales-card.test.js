import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261020235500_commerce_shopee_verified_variations_v2.sql','utf8');

test('Shopee exposes only two sale statuses and does not claim unmatched SKU as zero',()=>{
  assert.match(ui,/const SALES_FILTERS=\[\['SOLD','Com vendas'\],\['ZERO','Sem vendas'\]\]/);
  assert.match(ui,/const noSalesStatus='ZERO'/);
  assert.match(ui,/const noSalesValue=kpi\.zero_ads/);
  assert.doesNotMatch(ui,/const shopeeUnlinkedView|Sem vínculo \(Shopee\)\s*<\/button>/);
  assert.match(ui,/Se um vínculo estiver ambíguo/);
});
test('certified no-sales require import coverage and every variation reviewed',()=>{
  assert.match(sql,/shopee_sku_ownership as \(/);
  assert.match(sql,/owner\.listing_product_id=v\.id/);
  assert.match(sql,/so\.total=so\.verified/);
  assert.match(sql,/sw\.sales_days>=b\.days and sw\.report_days>=b\.days/);
  assert.match(sql,/selected_status='ZERO' and c\.ready and c\.units=0/);
  assert.match(sql,/shopee_unclassified_ads/);
  assert.match(sql,/revoke all on function public\.commerce_listing_manager_v1/);
  assert.match(sql,/to service_role/);
});
test('Shopee monthly period cannot be claimed as verified zero',()=>{
  assert.match(ui,/disabled=\{code==='ZERO'&&days===0&&platform==='SHOPEE'\}/);
  assert.match(ui,/onClick=\{platform==='SHOPEE'&&days===0\?undefined:changeNoSales\}/);
});
