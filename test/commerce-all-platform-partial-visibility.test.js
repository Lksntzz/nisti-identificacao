import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shopeeSalesTotals } from '../src/commerce-ad-evidence.js';

const managerSql=fs.readFileSync('supabase/migrations/20261019190000_commerce_listing_manager_shared_window_v1.sql','utf8');
const ordersSql=fs.readFileSync('supabase/migrations/20261019191000_commerce_order_metrics_shared_window_v1.sql','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');

test('TODAS combina ML por ID com Shopee por SKU sem esconder o resultado por falta de cobertura Shopee',()=>{
  const data={source_kind:'MIXED_LISTING_SKU_PARTIAL',
    kpis:{active_ads:552,covered_ads:236,sold_ads:60,identified_ads:89,
      units:339,revenue:19138.58,identified_units:1313,identified_revenue:45423.42}};
  assert.deepEqual(shopeeSalesTotals(data,7),{
    hasImportedTotal:false,units:1652,revenue:64562,
    linkedUnits:1313,linkedRevenue:45423.42,
    verifiedUnits:339,verifiedRevenue:19138.58
  });
});

test('TODAS mensal mostra valores brutos apenas com total importado confiável',()=>{
  const data={source_kind:'MIXED_LISTING_SKU_PARTIAL',
    kpis:{units:1008,revenue:40871.41,identified_units:5167,identified_revenue:178635.50},
    imported_month:{units:6302,revenue:225427.20}};
  const result=shopeeSalesTotals(data,0);
  assert.equal(result.hasImportedTotal,true);
  assert.equal(result.units,6302);
  assert.equal(result.revenue,225427.20);
  assert.equal(result.verifiedUnits,1008);
  assert.equal(result.linkedUnits,5167);
  assert.equal(shopeeSalesTotals({...data,imported_month:{units:5000,revenue:100000}},0).hasImportedTotal,false);
});

test('nunca transforma valor ausente em venda zero nem mistura valores dos anúncios',()=>{
  const base={source_kind:'MIXED_LISTING_SKU_PARTIAL',kpis:{
    identified_units:4,identified_revenue:100,units:null,revenue:null}};
  assert.equal(shopeeSalesTotals(base,7).units,4);
  assert.equal(shopeeSalesTotals({...base,kpis:{identified_units:5,identified_revenue:100,units:-1,revenue:0}},7),null);
  assert.equal(shopeeSalesTotals({...base,kpis:{identified_units:null,identified_revenue:null,units:2,revenue:99}},7),null);
  assert.match(ui,/linked\.hasSales\?num\(linked\.units\)/);
  assert.match(ui,/item\.ready\?num\(item\.units\)/);
  assert.match(ui,/partial=\{hasShopeePartial&&item\.source==='SHOPEE'&&!item\.ready\}/);
});

test('janelas conjuntas usam último dia em comum, e pedidos usam o mesmo corte',()=>{
  assert.match(managerSql,/latest_source_sale as \(/);
  assert.match(managerSql,/then min\(last_day\) else max\(last_day\)/);
  assert.match(managerSql,/MIXED_LISTING_SKU_PARTIAL/);
  assert.match(managerSql,/dc\.current_days>=b\.days and l\.source_code<>'SHOPEE'/);
  assert.match(ordersSql,/then min\(v\.last_day\) else max\(v\.last_day\)/);
  assert.match(ordersSql,/NO_POSTSALE_EVENTS_IMPORTED/);
  assert.doesNotMatch(managerSql,/insert into public\.commerce_sales|update public\.commerce_sales|delete from public\.commerce_sales/i);
});

test('Gestor diferencia vendas identificadas de total bruto e permite ver variações Shopee',()=>{
  assert.match(ui,/hasMixedPartial=data\?\.source_kind==='MIXED_LISTING_SKU_PARTIAL'/);
  assert.match(ui,/Faturamento identificado/);
  assert.match(ui,/Unidades identificadas/);
  assert.match(ui,/const partialAds=sourceBreakdown\?\.identified\?\?0/);
  assert.match(ui,/sourceBreakdown\.marketplaceWithSales/);
  assert.match(ui,/sourceBreakdown\.shopeeWithSales/);
  assert.match(ui,/num\(shopeeTotals\.units\)/);
  assert.match(ui,/money\(shopeeTotals\.revenue\)/);
});
