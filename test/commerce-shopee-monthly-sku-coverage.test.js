import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const month=fs.readFileSync('supabase/migrations/20261016174500_commerce_listing_manager_month_sku_v1.sql','utf8');
const monthlyExploration=fs.readFileSync('supabase/migrations/20261016221500_commerce_shopee_month_exploratory_v2.sql','utf8');
const evolution=fs.readFileSync('supabase/migrations/20261016175000_commerce_shopee_monthly_evolution_sku_v1.sql','utf8');

test('consulta mensal exclusiva da Shopee nunca estima vendas por nome, ID inventado ou SKU ambíguo',()=>{
  assert.match(store,/Number\(filters\.days\)===0 && cleanText\(filters\.month\) && cleanText\(filters\.platform\)==='SHOPEE'/);
  assert.match(store,/commerce_listing_manager_month_sku_v2/);
  assert.match(month,/from public\.commerce_sales_rows r/);
  assert.match(month,/join public\.commerce_sales_snapshots sn on sn\.id=r\.snapshot_id and sn\.is_current/);
  assert.match(month,/u\.source=r\.platform_code/);
  assert.match(month,/having count\(\*\)=1/);
  assert.match(month,/where p_month ~ /);
  assert.match(month,/and a\.month_linked_units>0/);
  assert.doesNotMatch(month,/insert into public\.products|update public\.products|delete from public\.products/);
});

test('API original continua sem zero definitivo; v2 permite apenas zero identificado e ABC indicativa',()=>{
  assert.match(month,/0::int covered_ads,0::int sold_ads,0::int zero_ads/);
  assert.match(month,/and i\.selected_curve='ALL'/);
  assert.match(month,/i\.selected_status='ALL' or/);
  assert.match(month,/month_linked_units>0/);
  assert.match(month,/'ready',false/);
  assert.match(month,/'variation_data_complete',false/);
  assert.match(ui,/hasShopeePartial&&code==='ZERO'/);
  assert.match(ui,/hasShopeePartial&&code!=='ALL'/);
  assert.match(monthlyExploration,/i.selected_status='ZERO'/);
  assert.match(monthlyExploration,/identified_empty_variations>0/);
  assert.match(monthlyExploration,/p.curve,'curve_partial',true/);
  assert.match(monthlyExploration,/p_basis text default 'REVENUE'/);
  assert.match(css,/\.nim-status\.partial\{/);
  assert.match(css,/nim-status-tabs button:disabled/);
});

test('vendas parciais aparecem na tabela, nos indicadores e nos detalhes, sem valores presumidos',()=>{
  assert.match(ui,/hasShopeePartial&&data\?'≥ '\+num\(partialUnits\)/);
  assert.match(ui,/hasShopeePartial&&data\?'≥ '\+money\(partialRevenue\)/);
  assert.match(ui,/hasShopeePartial&&Number\(item\.month_linked_units\|\|item\.identified_units\)>0/);
  assert.match(ui,/partialLinked\?'≥ '\+num\(partialUnits\)/);
  assert.match(ui,/partialRelevant\.map\(\(v,i\)=>/);
  assert.match(ui,/v\.units==null\?'Não identificada':'≥ '\+num\(v\.units\)/);
  assert.match(ui,/Vendas identificadas/);
  assert.match(ui,/unidade\(s\),.*sem anúncio ativo correspondente/);
});

test('histórico mensal do anúncio e da plataforma usam apenas SKUs exclusivos',()=>{
  assert.match(evolution,/create or replace function public\.commerce_listing_manager_months_v1/);
  assert.match(evolution,/min\(l\.id\) listing_id,count\(\*\) n/);
  assert.match(evolution,/u\.listing_id=c\.id and u\.n=1/);
  assert.match(evolution,/where not exists \(select 1 from daily d where d\.period=m\.period\)/);
  assert.match(evolution,/commerce_listing_manager_monthly_sku_v1/);
  assert.match(evolution,/o\.uses=1/);
  assert.match(store,/commerce_listing_manager_monthly_sku_v1/);
  assert.match(ui,/months\?\.some\(m=>m\.partial\)/);
  assert.match(ui,/monthly\?\.months\?\.some\(m=>m\.partial\)/);
});

test('novas funções SQL não são expostas ao público',()=>{
  assert.match(month,/security invoker set search_path=public/);
  assert.match(month,/from public,anon,authenticated/);
  assert.match(month,/to service_role/);
  assert.match(monthlyExploration,/from public,anon,authenticated/);
  assert.match(monthlyExploration,/to service_role/);
  assert.match(evolution,/security invoker set search_path=public/);
  assert.match(evolution,/from public,anon,authenticated/);
  assert.match(evolution,/to service_role/);
});
