import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shopeeAdsRowsForPeriod,preferredShopeeAdsReport}
  from '../src/commerce-shopee-ads-period.js';
import {importedTotalsForExactWindow} from '../src/commerce-ad-evidence.js';

const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const ads=fs.readFileSync('src/commerce-shopee-ads-summary.jsx','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');

test('Shopee Ads cumulative reports never masquerade as 7-day or 30-day metrics',()=>{
  const reports=[
    {report_kind:'GENERAL',start:'2026-07-20',end:'2026-10-20',clicks:1000},
    {report_kind:'TARGETING',start:'2026-07-20',end:'2026-10-20',clicks:400},
    {report_kind:'GENERAL',start:'2026-10-10',end:'2026-10-16',clicks:23}
  ];
  assert.deepEqual(shopeeAdsRowsForPeriod(reports,'2026-10-10','2026-10-16').map(x=>x.clicks),[23]);
  assert.equal(shopeeAdsRowsForPeriod(reports,'2026-10-09','2026-10-15').length,0);
  assert.equal(shopeeAdsRowsForPeriod(reports,null,null).length,0);
  assert.equal(shopeeAdsRowsForPeriod(reports,'2026-10-10','2026-10-16',false).length,3);
  assert.equal(preferredShopeeAdsReport(reports).clicks,1000);
  assert.equal(preferredShopeeAdsReport([]),null);
});

test('7-day sales totals are shown only when exact source dates match filter',()=>{
 const totals={available:true,period_start:'2026-10-10',period_end:'2026-10-16',
  units:1298,revenue:44760.68,sources:[{source:'SHOPEE'}]};
 assert.deepEqual(importedTotalsForExactWindow(totals,'2026-10-10','2026-10-16'),
  {units:1298,revenue:44760.68,sources:totals.sources});
 assert.equal(importedTotalsForExactWindow(totals,'2026-10-09','2026-10-15'),null);
 assert.equal(importedTotalsForExactWindow({...totals,units:-1},'2026-10-10','2026-10-16'),null);
 assert.equal(importedTotalsForExactWindow({...totals,available:false},'2026-10-10','2026-10-16'),null);
});

test('seven-day financial disclosure shows exact dates and sales only, never paid GMV',()=>{
 assert.match(ui,/if\(days===7&&commercialView==='LISTINGS'\)setFinancialOpen\(true\)/);
 assert.match(ui,/importedTotalsForExactWindow\(/);
 assert.match(ui,/verifiedImportedTotals\.units/);
 assert.match(ui,/verifiedImportedTotals\.revenue/);
 assert.match(ui,/periodDate\(data\.period_start\)/);
 assert.match(ui,/periodDate\(data\.period_end\)/);
 assert.match(ui,/A publicidade Shopee Ads é calculada separadamente/);
 assert.match(store,/commerce_imported_sales_totals_v1/);
});

test('Shopee Ads option is limited to Ads listings and uses the parent filter dates',()=>{
 assert.match(ui,/adsOnlySelectedPeriod,setAdsOnlySelectedPeriod/);
 assert.match(ui,/periodStart=\{periodStart\} periodEnd=\{periodEnd\}/);
 assert.match(ui,/onOnlySelectedPeriodChange=\{setAdsOnlySelectedPeriod\}/);
 assert.match(ui,/shopeeAdsRowsForPeriod\(\s*adsOverview\.items,periodStart,periodEnd,adsOnlySelectedPeriod\)/);
 assert.match(ads,/checked=\{Boolean\(onlySelectedPeriod\)\}/);
 assert.match(ads,/Mostrar somente o período selecionado no filtro/);
 assert.match(ads,/Não há relatório Shopee Ads exatamente para/);
 assert.match(ads,/desmarque a opção para consultar o acumulado/);
 assert.doesNotMatch(ads,/impressions\s*\/\s*days|clicks\s*\/\s*days/);
});
