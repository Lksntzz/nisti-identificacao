import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');
const ui=read('src/commerce-ad-manager.jsx');
const css=read('src/commerce-ad-manager.css');
const sql=read('supabase/migrations/20261016152000_commerce_listing_manager_v1.sql');
const monthly=read('supabase/migrations/20261016153000_commerce_listing_manager_monthly_v1.sql');
const store=read('src/commerce-supabase-store.js');
const router=read('src/commerce-admin-router.js');
const main=read('src/main.jsx');
const admin=read('src/commerce-admin-app-v2.jsx');

test('the new Gestor de Anúncios replaces the old commercial dashboard in both entry points',()=>{
  assert.match(main,/import CommerceCommercialDashboard from '.\/commerce-ad-manager.jsx'/);
  assert.match(admin,/import CommerceCommercialDashboard from '.\/commerce-ad-manager.jsx'/);
  assert.match(ui,/<h2>Gestor de Anúncios<\/h2>/);
  assert.match(ui,/Lista de anúncios/);
  assert.doesNotMatch(ui,/ProductCutoutImage|<img\b|<picture\b/);
  assert.match(css,/\.nim-ad-table/);
  assert.match(css,/\.nim-detail/);
});

test('the default list shows all active ads and supports shared filters and real month analysis',()=>{
  for(const title of ['Todas as plataformas','Mercado Livre Antigo','Mercado Livre Novo','Shopee','Amazon','TikTok Shop'])
    assert.ok(ui.includes(title),title);
  assert.match(ui,/useState\('ALL'\)/);
  assert.match(ui,/useState\(30\)/);
  assert.match(ui,/Últimos \{n\} dias/);
  assert.match(ui,/value=\{month\}/);
  assert.match(ui,/<option value="MONTH">Personalizado · escolher mês<\/option>/);
  assert.doesNotMatch(ui,/Mês de referência/);
  assert.match(ui,/placeholder="Nome ou ID do anúncio"/);
  assert.match(ui,/Analisar vendas mensais/);
  assert.match(ui,/MonthBars months=\{monthly\?\.months\}/);
  assert.match(ui,/onClick=\{\(\)=>setSelectedId\(item.id\)\}/);
  assert.match(ui,/onClick=\{\(\)=>setImportOpen\(v=>!v\)\}/);
  assert.match(ui,/CommerceImportCenter embedded/);
});

test('one zero-sales filter includes unpurchased variations even if other variations sold',()=>{
  assert.match(ui,/\['ZERO','Sem vendas'\]/);
  assert.doesNotMatch(ui,/Anúncios sem vendas.*Variações sem vendas/);
  assert.match(sql,/b.selected_status='ZERO' and c.ready and \(c.units=0 or c.zero_variations>0\)/);
  assert.match(ui,/Number\(item.zero_variations\)>0/);
  assert.match(ui,/zeroFilter&&!showAll\?variations.filter\(v=>v.units===0\)/);
  assert.match(ui,/Mostrar todas as variações/);
  assert.match(ui,/Sem vendas/);
});

test('per-listing sales use exact ID and source, with no SKU-wide allocation',()=>{
  assert.match(sql,/d.external_listing_id=l.external_listing_id and d.platform_code=l.source_code/);
  assert.match(sql,/join public.commerce_sales_import_stage_summary s on s.batch_id=ib.id/);
  assert.match(sql,/ib.status='COMMITTED'/);
  assert.match(sql,/dc.current_days>=b.days ready/);
  assert.match(sql,/coalesce\(u.units,0\)::bigint units/);
  assert.match(sql,/where l.listing_status='ACTIVE'/);
  assert.match(sql,/case when not ready then 'PENDING'/);
  assert.doesNotMatch(sql,/insert into public\.products|delete from public\.products|update public\.products/);
});

test('variation units require unambiguous linked variation SKU, and unmatched sales cannot yield false zero',()=>{
  assert.match(sql,/public.commerce_listing_products lp/);
  assert.match(sql,/nullif\(lp.variation_id,''\) is not null/);
  assert.match(sql,/variant_uniqueness as/);
  assert.match(sql,/vu.sku_uses>1/);
  assert.match(sql,/unmatched_units as/);
  assert.match(sql,/coalesce\(u.unmapped_units,0\)>0/);
  assert.match(sql,/then null::bigint else coalesce\(st.units,0\)/);
  assert.match(sql,/variation_data_complete/);
  assert.match(ui,/não mostramos zeros presumidos/);
});

test('ABC ranks active advertisement IDs and monthly reporting filters by source and ID',()=>{
  assert.match(sql,/sum\(f.score\) over\(\)/);
  assert.match(sql,/when r.previous_score<r.score_total\*0.80 then 'A'/);
  assert.match(sql,/when r.previous_score<r.score_total\*0.95 then 'B'/);
  assert.match(ui,/className=\{'nim-curve badge-'/);
  assert.match(ui,/Faturamento/);
  assert.match(ui,/Unidades/);
  assert.match(monthly,/join active_listing_ids a on a.source=d.platform_code and a.external_listing_id=d.external_listing_id/);
  assert.match(monthly,/where l.listing_status='ACTIVE'/);
  assert.match(sql,/commerce_listing_manager_months_v1/);
});

test('endpoints are authenticated admin routes and RPCs restrict direct public access',()=>{
  assert.match(router,/\/listings\/manager/);
  assert.match(router,/commerceListingManager\(env/);
  assert.match(router,/commerceListingManagerMonthly\(env/);
  assert.match(router,/commerceListingManagerMonths\(env/);
  assert.match(router,/\[0,7,30,60,90\]\.includes\(days\)/);
  assert.match(router,/\['ALL','SOLD','ZERO','LOW','RISING','PENDING'\]\.includes\(status\)/);
  assert.match(store,/commerce_listing_manager_v1/);
  assert.match(store,/commerce_listing_manager_months_v1/);
  assert.match(store,/commerce_listing_manager_monthly_v1/);
  assert.match(sql,/to service_role/);
  assert.match(monthly,/to service_role/);
  assert.match(sql,/from public,anon,authenticated/);
  assert.doesNotMatch(sql,/grant execute.*to anon|grant execute.*to authenticated/);
});
