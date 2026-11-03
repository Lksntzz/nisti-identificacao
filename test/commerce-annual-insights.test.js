import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const sql=read('supabase/migrations/20261103180000_commerce_annual_listing_insights_v1.sql');
const jsx=read('src/commerce-annual-insights.jsx');
const css=read('src/commerce-annual-insights.css');
const router=read('src/commerce-admin-router.js');
const store=read('src/commerce-supabase-store.js');
const parent=read('src/commerce-annual-guided.jsx');

test('somente histórico de anúncios por plataforma e ID: nunca por SKU',()=>{
  assert.match(sql,/old_ads as materialized/);
  assert.match(sql,/group by s\.platform,s\.id/);
  assert.match(sql,/o\.platform=s\.platform and o\.id=s\.id/);
  assert.doesNotMatch(sql,/sku_norm|canonical_sku|commerce_sku_canon_v1/);
  assert.match(sql,/new_ads as \(/);
  assert.match(sql,/not exists\(select 1 from old_ads/);
});

test('mês parcial usa corte da mesma data e futuro não vira zero',()=>{
  assert.match(sql,/s\.sale_date<=make_date\(b\.b,m\.mon/);
  assert.match(sql,/m\.mon>b\.current_month then null::bigint/);
  assert.match(sql,/not b\.current_available/);
  assert.match(sql,/b\.as_of is not null and s\.sale_date<=b\.as_of/);
  assert.match(jsx,/future\?'—'/);
  assert.match(jsx,/Sem base/);
});

test('anúncio histórico que zerou é mantido e sinalizado',()=>{
  assert.match(sql,/d\.base_units>0 and d\.current_units=0/);
  assert.match(jsx,/Parou de vender/);
  assert.match(jsx,/new_ads\?\.count/);
  assert.match(jsx,/ficam de fora/);
  assert.match(jsx,/Pode ter ocorrido migração de vendas/);
});

test('painel em cards, gráfico mensal, detalhe sob demanda e modo escuro',()=>{
  assert.match(parent,/AnnualListingInsights/);
  assert.match(jsx,/function ListingCard/);
  assert.match(jsx,/function PairChart/);
  assert.match(jsx,/listing_months/);
  assert.match(jsx,/\[10,20,50,100\]/);
  assert.match(css,/\.ga-dark \.gai-root/);
  assert.match(css,/@media\(max-width:600px\)/);
});

test('consulta é protegida na API e função SQL somente leitura',()=>{
  assert.match(router,/sales-compare\/annual-listing-insights/);
  assert.match(router,/base!==year-1/);
  assert.match(store,/commerce_annual_listing_insights_v1/);
  assert.match(sql,/language sql stable security invoker/);
  assert.match(sql,/revoke all on function public\.commerce_annual_listing_insights_v1[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_annual_listing_insights_v1[\s\S]*to service_role/);
  assert.doesNotMatch(sql,/\b(insert into|update public\.|delete from|truncate table)\b/i);
});

test('histórico não importado não gera contagens falsas de anúncios novos',()=>{
  assert.match(store,/data\.base_available===false/);
  assert.match(store,/new_ads:\{count:null,units:null\}/);
  assert.match(jsx,/Sem base para identificar anúncios novos/);
});
