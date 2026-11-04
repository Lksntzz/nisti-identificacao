import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {familyMetricTotals,canLinkFamilyProduct,familyDetailsByMonth,familyReportMonths} from '../src/commerce-annual-families-helpers.js';

const read=path=>fs.readFileSync(path,'utf8');

test('meses futuros nao entram como zero no historico comparavel',()=>{
  const rows=[
    {month:1,base_units:80,cur_units:100,base_revenue:2400,cur_revenue:3000},
    {month:2,base_units:null,cur_units:null,base_revenue:null,cur_revenue:null}
  ];
  assert.deepEqual(familyMetricTotals(rows,'units'),{
    base:80,cur:100,best:rows[0]
  });
  assert.equal(familyMetricTotals(rows,'revenue').cur,3000);
  assert.equal(familyMetricTotals(rows.map(r=>({...r,cur_units:0})),'units').best,null);
});

test('resumo geral mostra vendas sem familia; filtro de familia preserva apenas o grupo confirmado',()=>{
  const report={
    overall_months:[{month:1,base_units:null,cur_units:53131,base_revenue:null,cur_revenue:123456}],
    months:[{month:1,base_units:null,cur_units:0,base_revenue:null,cur_revenue:0}]
  };
  assert.equal(familyMetricTotals(familyReportMonths(report,''),'units').cur,53131);
  assert.equal(familyMetricTotals(familyReportMonths(report,'10'),'units').cur,0);
  assert.equal(familyMetricTotals(familyReportMonths(report,''),'units').base,0);
  assert.deepEqual(familyReportMonths({months:[]},''),[],'dados gerais ausentes nao devem ser inventados');
});

test('familia aceita outra capa e SKU, mas nao categoria divergente nem vinculo preexistente',()=>{
  const family={id:1,category_id:4,model_name:'Agenda diaria',format_name:'A5'};
  assert.equal(canLinkFamilyProduct(family,{id:20,category_id:4,family_id:null,sku:'CAPA-A'}),true);
  assert.equal(canLinkFamilyProduct(family,{id:21,category_id:4,family_id:null,sku:'CAPA-B'}),true);
  assert.equal(canLinkFamilyProduct(family,{id:22,category_id:7,family_id:null}),false);
  assert.equal(canLinkFamilyProduct(family,{id:23,category_id:4,family_id:5}),false);
});

test('detalhamento de um mes compara as duas edicoes sem misturar SKU ou anuncio',()=>{
  const rows=[
    {month:1,product_id:1,sku:'FLORAL-26',platform:'SHOPEE',listing_id:'111',product_name:'Floral',cur_units:3,base_units:8,cur_revenue:90,base_revenue:240},
    {month:2,product_id:1,sku:'FLORAL-26',platform:'SHOPEE',listing_id:'111',product_name:'Floral',cur_units:4,base_units:2,cur_revenue:120,base_revenue:60},
    {month:1,product_id:2,sku:'LISA-27',platform:'SHOPEE',listing_id:'222',product_name:'Lisa',cur_units:5,base_units:0,cur_revenue:150,base_revenue:0}
  ];
  assert.equal(familyDetailsByMonth(rows,'1').length,2);
  assert.deepEqual(familyDetailsByMonth(rows,'1').map(x=>x.sku),['FLORAL-26','LISA-27']);
  const yearly=familyDetailsByMonth(rows,'');
  assert.equal(yearly.length,2);
  assert.equal(yearly.find(x=>x.sku==='FLORAL-26').cur_units,7);
  assert.equal(yearly.find(x=>x.sku==='FLORAL-26').base_revenue,300);
  assert.equal(yearly.find(x=>x.sku==='LISA-27').cur_units,5);
});

test('schema de familias e reversivel, manual, auditado e limitado ao service_role',()=>{
  const sql=read('supabase/migrations/20261104150000_commerce_annual_product_families_v1.sql');
  for(const table of ['commerce_product_families_v1','commerce_product_family_members_v1','commerce_product_family_events_v1']){
    assert.match(sql,new RegExp('create table if not exists public\\.'+table));
    assert.match(sql,new RegExp('alter table public\\.'+table+' enable row level security'));
  }
  assert.match(sql,/primary key references public\.commerce_products\(id\) on delete restrict/);
  assert.match(sql,/p_confirmed is distinct from true/);
  assert.match(sql,/Produto ja vinculado a outra familia/);
  assert.match(sql,/grant execute on function public\.commerce_product_family_member_set_v1[^;]*to service_role/i);
  assert.doesNotMatch(sql,/grant (all|select|insert|update|delete) on public\.commerce_product_families_v1 to anon/i);
});

test('report so atribui SKU com proprietario unico e nao mistura ano da edicao com ano da venda',()=>{
  const sql=read('supabase/migrations/20261104151000_commerce_annual_family_report_v1.sql');
  assert.match(sql,/having count\(distinct s\.product_id\)=1/);
  assert.match(sql,/y\.sales_year>=s\.valid_from_year/);
  assert.match(sql,/y\.sales_year<=s\.valid_to_year/);
  assert.match(sql,/p\.edition_year>s\.sales_year\+1/);
  assert.match(sql,/commerce_current_sales_listing_daily_v1/);
  assert.match(sql,/t\.sales_month as month/);
  assert.match(sql,/unclassified_cur_units/);
  assert.match(sql,/unmapped_cur_units/);
  assert.match(sql,/without_family_cur_units/);
  assert.match(sql,/platforms_not_comparable/);
  assert.match(sql,/platform_coverage/);
  assert.match(sql,/revoke all on function public\.commerce_annual_family_report_v1[^;]*from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.commerce_annual_family_report_v1[^;]*to service_role/i);
});

test('migration v2 devolve meses gerais separados da classificacao, sem expor RPC publicamente',()=>{
  const sql=read('supabase/migrations/20261104162000_commerce_annual_family_overview_v2.sql');
  assert.match(sql,/overall_month_totals as \(/);
  assert.match(sql,/from relevant t\s+group by t.sales_month,t.side/);
  assert.match(sql,/'overall_months',coalesce/);
  assert.match(sql,/'months',coalesce/);
  assert.match(sql,/where t.family_id is not null and \(p_family_id is null or t.family_id=p_family_id\)/);
  assert.match(sql,/revoke all on function public\.commerce_annual_family_report_v1[^;]*from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.commerce_annual_family_report_v1[^;]*to service_role/i);
});

test('comparacao anual usa familias e edicoes no menu existente, sem criar outro painel',()=>{
  const app=read('src/commerce-admin-app-v2.jsx');
  const panel=read('src/commerce-commercial-panel.jsx');
  const families=read('src/commerce-annual-families.jsx');
  const router=read('src/commerce-admin-router.js');
  const store=read('src/commerce-supabase-store.js');
  assert.match(app,/\{ id: 'comparison', label: 'Comparação anual' \}/);
  assert.doesNotMatch(app,/\{ id: 'families', label:/);
  assert.match(panel,/view==='comparison'&&<CommerceAnnualFamilies/);
  assert.doesNotMatch(panel,/view==='families'/);
  assert.doesNotMatch(panel,/CommerceAnnualCompare/);
  assert.match(families,/Comparação anual · Famílias e edições/);
  assert.match(router,/sales-compare\/families\/catalog/);
  assert.match(router,/sales-compare\/families\/report/);
  assert.match(store,/commerce_annual_family_report_v1/);
});
