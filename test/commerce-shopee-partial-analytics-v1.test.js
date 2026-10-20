import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const daily=fs.readFileSync('supabase/migrations/20261016221000_commerce_shopee_analytical_filters_v1.sql','utf8');
const monthly=fs.readFileSync('supabase/migrations/20261016221500_commerce_shopee_month_exploratory_v2.sql','utf8');
const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');

test('daily zero filter includes variations without confirmed linked sales inside a sold listing',()=>{
  assert.match(daily,/c\.source_code='SHOPEE' and\s*\(coalesce\(c\.identified_units,0\)=0 or coalesce\(c\.identified_empty_variations,0\)>0\)/);
  assert.match(daily,/count\(\*\) filter\(where vu\.sku_uses=1 and nullif\(v\.sku_norm,''\) is not null\s*and coalesce\(st\.units,0\)=0\)::int identified_empty_variations/);
  assert.match(daily,/'identified_empty_variations',p\.identified_empty_variations/);
  assert.match(daily,/'identifiable_variations',p\.identifiable_variations/);
  assert.match(ui,/partialRelevant=zeroFilter&&!showAll/);
  assert.match(ui,/partialVars\.filter\(v=>v\.units==null\|\|Number\(v\.units\)===0\)/);
  assert.match(ui,/partialRelevant\.map\(\(v,i\)=>/);
  assert.match(ui,/v\.units==null\?'Não identificada':num\(v\.units\)/);
  assert.match(ui,/Nenhuma variação sem vendas identificadas neste anúncio/);
});

test('zero is never asserted as an established fact in Shopee without verified full daily coverage',()=>{
  assert.match(daily,/\(dc\.current_days>=b\.days and l\.source_code<>'SHOPEE'\) ready/);
  assert.match(daily,/\(dc\.previous_days>=b\.days and l\.source_code<>'SHOPEE'\) previous_ready/);
  assert.match(daily,/'source_kind',case when \(select platform from input\)='SHOPEE'/);
  assert.match(ui,/const noSalesLabel='Sem vendas'/);
  assert.match(ui,/não comprova.*todos os pedidos/);
  assert.match(ui,/zeros não são presumidos/);
  assert.match(ui,/SKUs compartilhados entre anúncios/);
});

test('ABC on Shopee ranks only known lower-bound sales by revenue or units and labels provisional',()=>{
  assert.match(daily,/l\.source_code='SHOPEE' then\s*case when b\.basis='UNITS' then l\.identified_units::numeric else l\.identified_revenue end/);
  assert.match(daily,/previous_score<r\.score_total\*0\.80/);
  assert.match(daily,/previous_score<r\.score_total\*0\.95/);
  assert.match(daily,/'curve_partial',p\.source_code='SHOPEE' and p\.curve is not null/);
  assert.match(ui,/Curva ABC\{hasShopeePartial\?' · indicativa':''\}/);
  assert.match(ui,/ABC indicativa: calculada apenas com vendas identificadas/);
  assert.match(ui,/item\.curve_partial\?'\*':''/);
  assert.doesNotMatch(daily,/insert into public\.products|update public\.products|update public\.commerce_sales_rows/);
});

test('growth compares equal-length real periods and rejects zero baseline',()=>{
  assert.match(daily,/d\.sale_date between b\.previous_start and b\.previous_end/);
  assert.match(daily,/identified_prev_units/);
  assert.match(daily,/identified_growth_pct',case when p\.source_code='SHOPEE' and p\.identified_prev_units>0/);
  assert.match(daily,/identified_units-p\.identified_prev_units/);
  assert.match(ui,/Tendência identificada/);
  assert.match(ui,/Sem base comparável/);
  assert.match(ui,/Comparação com igual período anterior · vendas vinculadas/);
});

test('month v2 supports provisional units/revenue ABC and the same unsold-variation filter',()=>{
  assert.match(monthly,/commerce_listing_manager_month_sku_v2/);
  assert.match(monthly,/p_basis text default 'REVENUE'/);
  assert.match(monthly,/case when upper\(coalesce\(p_basis,''\)\)='UNITS'/);
  assert.match(monthly,/case when i\.basis='UNITS' then d\.month_linked_units::numeric/);
  assert.match(monthly,/i\.selected_status='ZERO'/);
  assert.match(monthly,/a\.identified_empty_variations>0/);
  assert.match(monthly,/'curve',p\.curve,'curve_partial',true/);
  assert.match(monthly,/count\(\*\) filter\(where uv\.variation_id is not null and k\.units is null\)/);
  assert.match(store,/commerce_listing_manager_month_sku_v2/);
  assert.match(store,/p_basis:cleanText\(filters\.basis\)==='UNITS'\?'UNITS':'REVENUE'/);
});

test('all new RPCs require service role and never modify Scanner products',()=>{
  for(const sql of [daily,monthly]){
    assert.match(sql,/security invoker set search_path=public/);
    assert.match(sql,/from public,anon,authenticated/);
    assert.match(sql,/to service_role/);
    assert.doesNotMatch(sql,/insert into public\.products|update public\.products|delete from public\.products|update public\.commerce_sales_rows/);
  }
  assert.doesNotMatch(fs.readFileSync('supabase/migrations/20261020235000_commerce_shopee_two_filters_reconciled_v1.sql','utf8'),/delete from public\.products|update public\.products/);
});
