import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import esbuild from 'esbuild';
import {pathToFileURL} from 'node:url';
import {priceChanges,cancelRate,unitEconomics,funnelRows,overlapping,adsRoas} from '../src/ga/commerce-listing-sheet-logic.js';
const read=p=>fs.readFileSync(p,'utf8');
const wk=(week_start,o={})=>({week_start,partial:false,units:100,has_extras:true,extras_units:100,price_paid_avg:20,price_orig_avg:40,
  cancelled_units:10,ship_est_avg:10,ship_paid_avg:2,fee_pct:20,...o});

test('ficha: mudança de preço só a partir de 3% entre semanas seguidas com dados de pedido',()=>{
  const weeks=[wk('2026-01-05'),wk('2026-01-12',{price_paid_avg:20.4}),wk('2026-01-19',{price_paid_avg:22}),
    wk('2026-01-26',{has_extras:false,price_paid_avg:null}),wk('2026-02-02',{price_paid_avg:22.1})];
  const c=priceChanges(weeks);
  assert.equal(c.length,1);
  assert.deepEqual([c[0].week_start,c[0].from,c[0].to],['2026-01-19',20.4,22]);
});
test('ficha: cancelamento usa só semanas completas com dados de pedido',()=>{
  const weeks=[wk('2026-01-05'),wk('2026-01-12'),wk('2026-01-19',{partial:true,cancelled_units:999}),wk('2026-01-26',{has_extras:false,extras_units:null,cancelled_units:null})];
  const r=cancelRate(weeks,4);
  assert.equal(r.weeks,2);
  assert.equal(r.cancelled,20);
  assert.equal(r.confirmed,200);
  assert.ok(Math.abs(r.pct-(20/220*100))<1e-9);
  assert.equal(cancelRate([wk('2026-01-05',{has_extras:false})]),null);
});
test('ficha: o que sobra por unidade = preço - taxas - frete líquido, ponderado por unidades',()=>{
  const e=unitEconomics([wk('2026-01-05',{extras_units:100,price_paid_avg:30}),wk('2026-01-12',{extras_units:300,price_paid_avg:34})]);
  assert.equal(e.weeks,2);
  assert.ok(Math.abs(e.price-33)<1e-9);
  assert.ok(Math.abs(e.fees-6.6)<1e-9);
  assert.ok(Math.abs(e.shipNet-8)<1e-9);
  assert.ok(Math.abs(e.left-(33-6.6-8))<1e-9);
  assert.equal(e.complete,true);
});
test('ficha: sem taxas ou frete a conta avisa que está incompleta; sem dados devolve nulo',()=>{
  const e=unitEconomics([wk('2026-01-05',{fee_pct:null,ship_est_avg:null,ship_paid_avg:null})]);
  assert.equal(e.complete,false);
  assert.equal(e.fees,null);
  assert.equal(unitEconomics([wk('2026-01-05',{has_extras:false,price_paid_avg:null})]),null);
  assert.equal(unitEconomics([]),null);
});
test('ficha: funil calcula carrinho e conversão e marca janelas que se sobrepõem',()=>{
  const f=funnelRows([{period_start:'2026-09-26',period_end:'2026-10-25',visitors:1000,add_cart_visitors:200,orders_placed:50,impressions:9000},
    {period_start:'2026-08-01',period_end:'2026-08-31',visitors:0,add_cart_visitors:0,orders_placed:0,impressions:0}]);
  assert.equal(f[0].period_start,'2026-08-01');
  assert.equal(f[0].cartPct,null);
  assert.equal(f[1].cartPct,20);
  assert.equal(f[1].convPct,5);
  assert.equal(overlapping({period_start:'2026-09-26',period_end:'2026-10-25'},{period_start:'2026-10-06',period_end:'2026-11-04'}),true);
  assert.equal(overlapping({period_start:'2026-08-01',period_end:'2026-08-31'},{period_start:'2026-09-01',period_end:'2026-09-30'}),false);
  assert.equal(adsRoas({spend:100,gmv:900}),9);
  assert.equal(adsRoas({spend:0,gmv:5}),null);
});
test('ficha: rota, store, SQL e tela estão ligados e só leem',()=>{
  const router=read('src/ga/commerce-admin-router.js'),store=read('src/ga/commerce-supabase-store.js');
  const sql=read('supabase/migrations/20261106150000_commerce_shopee_listing_sheet_v1.sql');
  const ui=read('src/ga/commerce-listing-sheet.jsx'),mgr=read('src/ga/commerce-ad-manager.jsx');
  assert.match(router,/\/sheet\$\//);assert.match(router,/commerceShopeeListingSheet\(env,listingId,\{weeks\}\)/);
  assert.match(store,/commerce_shopee_listing_sheet_v1/);
  assert.match(sql,/language sql stable security invoker/);
  assert.match(sql,/revoke all on function public\.commerce_shopee_listing_sheet_v1\(bigint,integer\) from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_shopee_listing_sheet_v1\(bigint,integer\) to service_role/);
  assert.match(sql,/report_kind='GENERAL'/);
  assert.match(sql,/b\.status='COMMITTED'/);
  assert.doesNotMatch(sql,/\b(insert into|update public\.|delete from|truncate)\b/i);
  assert.match(ui,/Sem veredito|Só mostra dados/);
  assert.match(ui,/maskMoney/);
  assert.match(mgr,/CommerceListingSheet/);assert.match(mgr,/\['sheet','Histórico'\]/);
});

async function loadView(){
  const out=await esbuild.build({stdin:{contents:"import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {ListingSheetView} from './src/ga/commerce-listing-sheet.jsx';export const render=data=>renderToStaticMarkup(React.createElement(ListingSheetView,{data}));",resolveDir:process.cwd(),loader:'jsx'},
    bundle:true,write:false,format:'esm',jsx:'automatic',platform:'node',loader:{'.css':'empty'},
    banner:{js:"import {createRequire} from 'node:module';const require=createRequire("+JSON.stringify(pathToFileURL(process.cwd()+'/package.json').href)+");"},
    plugins:[{name:'stub-fetch',setup(b){b.onResolve({filter:/commerce-manager-fetch.js$/},()=>({path:'x',namespace:'stub'}));
      b.onLoad({filter:/.*/,namespace:'stub'},()=>({contents:'export const fetchCommercialManager=async()=>({});',loader:'js'}));}}]});
  const url='data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64');
  return (await import(url)).render;
}
const week=(i,o={})=>({week_start:new Date(Date.UTC(2026,0,5+i*7)).toISOString().slice(0,10),partial:false,units:50+i,revenue:1000,has_extras:true,
  extras_units:50+i,price_paid_avg:30,price_orig_avg:50,cancelled_units:5,ship_est_avg:12,ship_paid_avg:2,fee_pct:19,...o});
test('ficha: tela desenha com dados completos, sem dados de pedido e sem funil nem Ads',async()=>{
  const render=await loadView();
  const full=render({skus:2,sales_through:'2026-02-10',weeks:[week(0),week(1),week(2,{price_paid_avg:33}),week(3,{partial:true})],
    cancel_reasons:[{reason:'sistema: Pedido não pago',units:9}],uf_units:[{uf:'São Paulo',units:8}],
    funnel:[{period_start:'2026-01-01',period_end:'2026-01-31',visitors:1000,add_cart_visitors:200,orders_placed:50,impressions:9000}],
    ads:[{period_start:'2026-01-01',period_end:'2026-01-31',spend:100,gmv:900}]});
  assert.match(full,/Sobra antes do custo/);assert.match(full,/não informado/);assert.match(full,/9,0 para 1/);assert.match(full,/5,0%/);assert.match(full,/2 SKUs/);
  assert.match(full,/semana incompleta/);
  const bare=render({skus:1,sales_through:'2026-02-10',weeks:[week(0,{has_extras:false,extras_units:null,price_paid_avg:null,price_orig_avg:null,cancelled_units:null,ship_est_avg:null,ship_paid_avg:null,fee_pct:null})],
    cancel_reasons:[],uf_units:[],funnel:[],ads:[]});
  assert.match(bare,/Sem semanas completas com dados de pedido/);assert.match(bare,/não aparece nos relatórios de desempenho/);assert.match(bare,/Sem relatório de Ads/);
  assert.doesNotMatch(bare,/Sobra antes do custo/);
});
