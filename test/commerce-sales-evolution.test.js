import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync('supabase/migrations/20261019211000_commerce_sales_evolution_alias_names_v1.sql','utf8');
const router=fs.readFileSync('src/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');
const app=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const panel=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const css=fs.readFileSync('src/commerce-ad-manager.css','utf8');

test('painel comercial possui duas visões, sem remover os anúncios existentes',()=>{
  assert.match(app,/commercialView==='EVOLUTION'/);
  assert.match(app,/Evolução de vendas/);
  assert.match(app,/CommerceSalesEvolution/);
  assert.match(app,/commercialView==='LISTINGS'/);
  assert.match(app,/Lista de anúncios/);
  assert.match(css,/nim-evolution-controls/);
  assert.match(css,/max-width:550px/);
});

test('evolução usa somente um seletor para todas as situações, sem botões duplicados',()=>{
  assert.match(panel,/Situação das vendas<select value=\{status\} onChange=\{e=>onStatusChange\(e.target.value\)\}/);
  assert.match(panel,/statuses\.map\(\(\[code,label\]\)=><option value=\{code\}/);
  for(const state of ['ALL','SOLD','RISING','FALLING','STABLE','ZERO','NEW','LOW_VOLUME','INSUFFICIENT']){
    assert.match(panel,new RegExp("'"+state+"'"));
  }
  assert.doesNotMatch(panel,/nim-evolution-summary|nim-evolution-statuses|nim-evolution-kpi/);
  assert.doesNotMatch(css,/\.nim-evolution-summary|\.nim-evolution-statuses|\.nim-evolution-kpi/);
  assert.match(panel,/\[7,30,60,90\]\.map/);
  assert.match(panel,/onPlatformChange\(e.target.value\)/);
  assert.match(panel,/setDraft\(e.target.value\)/);
  assert.match(panel,/SKU\(s\)\/modelo\(s\) no filtro/);
  assert.match(panel,/SKU\/modelo sem vendas/);
});

test('trends comparam períodos idênticos e respeitam cobertura diária real',()=>{
  assert.match(sql,/b\.latest-\(b\.days-1\) current_start/);
  assert.match(sql,/b\.latest-b\.days previous_end/);
  assert.match(sql,/b\.latest-\(b\.days\*2-1\) previous_start/);
  assert.match(sql,/count\(distinct sale_date\) filter/);
  assert.match(sql,/v\.current_complete and v\.previous_complete/);
  assert.match(sql,/z\.previous_units<3 or abs\(z\.current_units-z\.previous_units\)<2/);
  assert.match(sql,/z\.current_units>=z\.previous_units\*1\.2/);
  assert.match(sql,/z\.current_units<=z\.previous_units\*0\.8/);
  assert.match(sql,/'LOW_VOLUME'/);
  assert.match(sql,/'INSUFFICIENT'/);
});
test('inclui todos os SKUs da Shopee, ML datado e aliases já aprovados',()=>{
  assert.match(sql,/commerce_shopee_sales_sku_daily_v1 d/);
  assert.match(sql,/commerce_current_sales_listing_daily_v1 d/);
  assert.match(sql,/chosen_shopee_day/);
  assert.match(sql,/snapshot_id=b\.snapshot_id/);
  assert.match(sql,/commerce_shopee_sku_owner_reviewed_v1 owner/);
  assert.match(sql,/coalesce\(owner\.canonical_sku_norm,r\.norm\)/);
  assert.match(sql,/commerce_sales_rows r/);
  assert.match(sql,/source_names as/);
  assert.match(sql,/count\(distinct a\.listing_id\)=1/);
  assert.match(sql,/null::text end listing_id/);
  assert.doesNotMatch(sql,/\b(update|insert into|delete from)\s+public\.commerce_sales_/i);
});
test('ações são sugestões, sem criação automática de promoções ou falsa venda zero',()=>{
  assert.match(panel,/Ação comercial sugerida/);
  assert.match(panel,/promoção somente depois de conferir a margem/);
  assert.match(panel,/Mudança de código|mudança\s+de\s+código/i);
  assert.match(panel,/current_units/);
  assert.match(panel,/previous_units/);
  assert.match(panel,/growth_pct/);
  assert.match(panel,/Sem ID exclusivo de anúncio identificado/);
  assert.doesNotMatch(panel,/fetch\([^)]*POST/);
});
test('API é protegida por admin, aceita filtros válidos e mantém RPC restrita',()=>{
  assert.match(router,/listings\/manager\/evolution/);
  assert.match(router,/commerceSalesEvolution\(env/);
  assert.match(router,/\[7,30,60,90\]\.includes\(days\)/);
  assert.match(store,/commerce_sales_evolution_v1/);
  assert.match(store,/timeoutMs:15000/);
  assert.match(sql,/security invoker set search_path=public/);
  assert.match(sql,/revoke all on function public\.commerce_sales_evolution_v1/);
  assert.match(sql,/to service_role/);
});
