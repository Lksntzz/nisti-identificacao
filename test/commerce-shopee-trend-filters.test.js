import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const daily=fs.readFileSync('supabase/migrations/20261016224500_commerce_shopee_trend_filters_v1.sql','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');

test('Shopee trend works in equal 7/30/60/90 day periods, not current wall-clock time',()=>{
  assert.match(daily,/when p_days in \(7,30,60,90\) then p_days else 30 end days/);
  assert.match(daily,/d\.period_end-d\.days previous_end/);
  assert.match(daily,/d\.period_end-d\.days\*2\+1 previous_start/);
  assert.match(daily,/d\.sale_date between b\.previous_start and b\.previous_end/);
  assert.match(daily,/d\.sale_date between b\.period_start and b\.period_end/);
  assert.match(daily,/coalesce\(\(select last_day from latest_sale\)/);
});

test('rising requires a meaningful matched baseline, falling never assumes a missing sale means zero',()=>{
  assert.match(daily,/l\.identified_prev_units>=3 and\s*l\.identified_units>=3 and l\.identified_units>=l\.identified_prev_units\*1\.2/);
  assert.match(daily,/l\.identified_prev_units>=3 and\s*l\.identified_units>0 and l\.identified_units<=l\.identified_prev_units\*0\.8/);
  assert.match(daily,/then 'RISING'/);
  assert.match(daily,/then 'FALLING'/);
  assert.match(daily,/c\.source_code='SHOPEE' and c\.identified_trend='RISING'/);
  assert.match(daily,/c\.source_code='SHOPEE'\s*and c\.identified_trend='FALLING'/);
  assert.match(daily,/b\.selected_status='RISING' and \(c\.growing/);
  assert.match(daily,/b\.selected_status='FALLING'/);
  assert.match(daily,/identified_growth_pct',case when p\.source_code='SHOPEE' and\s*p\.identified_prev_units>=3 and p\.identified_units>0/);
  assert.match(daily,/'identified_trend',p\.identified_trend/);
});

test('listing filter counts and ordering reflect the selected percentage trend',()=>{
  assert.match(daily,/count\(\*\) filter\(where source_code='SHOPEE' and identified_trend='RISING'\)::int growing_identified_ads/);
  assert.match(daily,/count\(\*\) filter\(where source_code='SHOPEE' and identified_trend='FALLING'\)::int falling_identified_ads/);
  assert.match(daily,/b\.selected_status='RISING' and c\.source_code='SHOPEE'/);
  assert.match(daily,/b\.selected_status='FALLING' and c\.source_code='SHOPEE'/);
  assert.match(daily,/desc nulls last/);
  assert.match(daily,/asc nulls last/);
  assert.match(daily,/cross join bounds b/);
});

test('compact UI preserves three primary sales filters and shows trend only for Shopee daily periods',()=>{
  assert.match(ui,/const SALES_FILTERS=\[\['ALL','Todos'\],\['SOLD','Com vendas'\],\['ZERO','Sem vendas'\]\]/);
  assert.match(ui,/const shopeeTrendAvailable=platform==='SHOPEE'&&days!==0/);
  assert.match(ui,/const trendSelected=\['RISING','FALLING'\]\.includes\(status\)\?status:'ALL'/);
  assert.match(ui,/shopeeTrendAvailable&&<label className="nim-filter-group nim-trend-group"/);
  assert.match(ui,/aria-label="Filtrar anúncios por tendência identificada"/);
  assert.match(ui,/<option value="RISING">Em alta/);
  assert.match(ui,/<option value="FALLING">Em queda/);
  assert.match(ui,/onChange=\{e=>change\(setStatus,e\.target\.value\)\}/);
  assert.match(ui,/if\(choice==='MONTH'&&\['RISING','FALLING'\]\.includes\(status\)\)setStatus\('ALL'\)/);
  assert.match(ui,/if\(\['RISING','FALLING'\]\.includes\(status\)\)setStatus\('ALL'\)/);
  assert.match(ui,/<td data-label="Situação"><Situation item=\{item\} days=\{days\}\/><\/td>/);
  assert.match(ui,/nim-trend-hint/);
  assert.match(css,/\.nim-filter-panel-body\.nim-has-trend/);
  assert.match(css,/\.nim-trend-hint\.up/);
  assert.match(css,/\.nim-trend-hint\.down/);
  assert.match(css,/@media\(max-width:920px\)/);
});

test('FALLING status remains behind authenticated manager route, and all new SQL is read-only',()=>{
  assert.match(router,/\['ALL','SOLD','ZERO','LOW','RISING','FALLING','PENDING'\]\.includes\(status\)/);
  assert.match(daily,/security invoker set search_path=public/);
  assert.match(daily,/revoke all on function public\.commerce_listing_manager_v1/);
  assert.match(daily,/to service_role/);
  assert.doesNotMatch(daily,/insert into public\.products|update public\.products|delete from public\.products|update public\.commerce_sales_rows/);
});
