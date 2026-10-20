import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261020232000_commerce_listing_manager_strict_zero_windows_v1.sql','utf8');

test('Shopee sem vendas identificadas maps the primary card and tab to UNLINKED',()=>{
  assert.match(manager,/const shopeeUnlinkedView=platform==='SHOPEE'&&days!==0/);
  assert.match(manager,/const noSalesStatus=shopeeUnlinkedView\?'UNLINKED':'ZERO'/);
  assert.match(manager,/const noSalesLabel=shopeeUnlinkedView\?'Sem vendas identificadas':'Sem vendas'/);
  assert.match(manager,/const noSalesValue=shopeeUnlinkedView\?kpi\.unlinked_shopee_ads:kpi\.zero_ads/);
  assert.match(manager,/onClick=\{\(\)=>code==='ZERO'\?changeNoSales\(\):change\(setStatus,code\)\}/);
  assert.match(manager,/const changeNoSales=\(\)=>change\(setStatus,status===noSalesStatus\?'ALL':noSalesStatus\)/);
  assert.match(manager,/status==='ZERO'&&days!==0\)setStatus\('UNLINKED'\)/);
  assert.match(manager,/Somente anúncios com zero unidades|Anúncios com zero unidades/);
  assert.match(manager,/ausência de vínculo NÃO comprova ausência de pedidos/);
});

test('No sales evidence remains explicitly separate from verified zero and unsold variations',()=>{
  assert.match(sql,/selected_status='ZERO' and c\.ready and c\.units=0/);
  assert.match(sql,/selected_status='UNLINKED' and c\.source_code='SHOPEE'/);
  assert.match(sql,/selected_status='VAR_ZERO' and c\.ready and c\.units>0/);
  assert.doesNotMatch(sql,/selected_status='ZERO' and c\.source_code='SHOPEE'/);
  assert.match(manager,/A Shopee não está incluída nessa contagem/);
  assert.match(manager,/status==='VAR_ZERO'/);
});

test('Shopee month does not claim full daily proof',()=>{
  assert.match(manager,/disabled=\{code==='ZERO'&&days===0&&platform==='SHOPEE'\}/);
  assert.match(manager,/onClick=\{platform==='SHOPEE'&&days===0\?undefined:changeNoSales\}/);
  assert.match(manager,/days===0&&next==='SHOPEE'&&status==='ZERO'/);
});
