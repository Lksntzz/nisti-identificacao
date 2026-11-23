import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pct,deltaPct,rates,funnelSteps,weakStep,enrichRows,sortRows,filterRows,toCsv,stallTags,filterStalled,sinceLabel,stalledCsv,STALL_DAYS} from '../src/ga/commerce-shopee-performance-view-logic.js';

const sql=fs.readFileSync('supabase/migrations/20261123130000_commerce_shopee_performance_overview_v1.sql','utf8');
const sqlAtivos=fs.readFileSync('supabase/migrations/20261123140000_commerce_shopee_performance_overview_active_only_v1.sql','utf8');
const router=fs.readFileSync('src/ga/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/ga/commerce-supabase-store.js','utf8');
const sqlStalled=fs.readFileSync('supabase/migrations/20261123150000_commerce_shopee_performance_stalled_v1.sql','utf8');
const dash=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');
const view=fs.readFileSync('src/ga/commerce-shopee-performance-view.jsx','utf8');

test('taxas: divisao segura e arredondamento nulo sem base',()=>{
  assert.equal(pct(5,100),5);assert.equal(pct(5,0),null);assert.equal(pct(null,10),0);
  assert.equal(deltaPct(150,100),50);assert.equal(deltaPct(10,0),null);
  assert.deepEqual(rates({impressions:1000,clicks:40,visitors:30,add_cart:6,orders:3}),{ctr:4,cart:20,conv:10});
});
test('funil tem 5 etapas na ordem impressao, clique, visita, carrinho, pedido',()=>{
  const s=funnelSteps({impressions:1000,clicks:40,visitors:30,add_cart:6,orders:3});
  assert.deepEqual(s.map(x=>x.key),['impressions','clicks','visitors','add_cart','orders']);
  assert.equal(s[1].rate,4);assert.equal(s[4].rate,10);
});
const store1={impressions:100000,clicks:4000,visitors:3000,add_cart:600,orders:150};
test('weakStep so marca com volume minimo e abaixo de 70% da media da loja',()=>{
  assert.equal(weakStep({impressions:500,clicks:1,visitors:3,add_cart:0,orders:0},store1),null);
  assert.equal(weakStep({impressions:5000,clicks:60,visitors:100,add_cart:20,orders:5},store1)?.key,'ctr');
  assert.equal(weakStep({impressions:5000,clicks:200,visitors:300,add_cart:12,orders:15},store1)?.key,'cart');
  assert.equal(weakStep({impressions:5000,clicks:200,visitors:300,add_cart:60,orders:3},store1)?.key,'conv');
  assert.equal(weakStep({impressions:5000,clicks:200,visitors:300,add_cart:60,orders:15},store1),null);
});
test('ordenacao poe nulos no fim e filtro ignora acento',()=>{
  const rows=enrichRows([
    {item_id:'1',title:'Caderneta de Vacinação',status:'ACTIVE',impressions:1000,clicks:50,visitors:40,add_cart:8,orders:4,revenue_paid:100},
    {item_id:'2',title:'Agenda',status:null,impressions:0,clicks:0,visitors:0,add_cart:0,orders:0,revenue_paid:900},
    {item_id:'3',title:'Planner',status:'ACTIVE',impressions:2000,clicks:40,visitors:30,add_cart:3,orders:1,revenue_paid:50,prev:{visitors:60,orders:2,revenue_paid:100}}
  ],store1);
  assert.deepEqual(sortRows(rows,'ctr','desc').map(r=>r.item_id),['1','3','2']);
  assert.deepEqual(sortRows(rows,'revenue_paid','desc').map(r=>r.item_id),['2','1','3']);
  assert.deepEqual(filterRows(rows,{q:'vacinacao'}).map(r=>r.item_id),['1']);
  assert.equal(filterRows(rows,{}).length,3);
  assert.equal(filterRows(rows,{weakOnly:true}).every(r=>r.weak),true);
  assert.equal(rows[2].visitors_delta,-50);
});
test('CSV usa ponto e virgula, virgula decimal e escapa aspas',()=>{
  const csv=toCsv(enrichRows([{item_id:'9',title:'A "b"; c',status:'ACTIVE',impressions:100,clicks:5,visitors:4,add_cart:1,orders:1,revenue_paid:12.5}],store1));
  assert.ok(csv.startsWith('﻿ID do item;'));
  assert.match(csv,/"A ""b""; c"/);assert.match(csv,/;5,00;/);assert.match(csv,/;12,50;/);
});
test('SQL: so leitura, sem escrita, privilegios restritos e funcao _v1',()=>{
  assert.match(sql,/create or replace function public\.commerce_shopee_performance_overview_v1/);
  assert.match(sql,/stable security invoker set search_path=public/);
  assert.match(sql,/from public,anon,authenticated/);assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/\b(insert into|update public|delete from|drop table|alter table)\b/i);
});
test('SQL: so anuncios ativos entram nos totais, na lista e na comparacao',()=>{
  assert.match(sqlAtivos,/join public\.commerce_listings l on l\.id=r\.listing_id and l\.listing_status='ACTIVE'/);
  assert.match(sqlAtivos,/external_item_id in \(select external_item_id from cur\)/);
  assert.doesNotMatch(sqlAtivos,/\b(insert into|update public|delete from|drop table|alter table)\b/i);
});
test('rota valida ids numericos e o botao abre a tela so com plataforma Shopee',()=>{
  assert.match(router,/\/shopee\/performance\/overview/);
  assert.match(router,/\[0-9\]\{1,12\}/);
  assert.match(store,/commerce_shopee_performance_overview_v1/);
  assert.match(dash,/ShopeePerformanceView/);
  assert.match(dash,/platform==='SHOPEE'/);
  assert.match(view,/\/api\/admin\/commerce\/shopee\/performance\/overview/);
});

test('bons que pararam: selos, filtros, rotulo de dias e CSV',()=>{
  const rows=[{item_id:'1',title:'Caderneta Safari',good_sales:true,good_traffic:true,days_since:9,last_sale:'2026-11-14',impressions:10,clicks:1,visitors:5,add_cart:1,orders:30,revenue_paid:900},
    {item_id:'2',title:'Agenda',good_sales:false,good_traffic:true,days_since:null,orders:0,revenue_paid:0}];
  assert.deepEqual(stallTags(rows[0]),['Vendeu bem','Muito tráfego']);
  assert.deepEqual(stallTags(rows[1]),['Muito tráfego']);
  assert.equal(filterStalled(rows,{kind:'vendas'}).length,1);
  assert.equal(filterStalled(rows,{kind:'trafego'}).length,2);
  assert.equal(filterStalled(rows,{q:'cadernéta'}).length,1);
  assert.equal(filterStalled(rows,{q:'caderneta'}).length,1);
  assert.equal(sinceLabel(rows[0]),'9 dias');assert.equal(sinceLabel(rows[1]),'sem venda no histórico');
  const csv=stalledCsv(rows);assert.match(csv,/Vendeu bem \+ Muito tráfego/);assert.match(csv,/14\/11\/2026;9/);
  assert.deepEqual(STALL_DAYS,[3,7,14,30]);
});
test('SQL bons que pararam: so ativos, so leitura, dias validados e privilegios',()=>{
  assert.match(sqlStalled,/commerce_shopee_performance_stalled_v1/);
  assert.match(sqlStalled,/listing_status='ACTIVE'/);
  assert.match(sqlStalled,/p_days in \(3,7,14,30\)/);
  assert.match(sqlStalled,/from public,anon,authenticated/);assert.match(sqlStalled,/to service_role/);
  assert.doesNotMatch(sqlStalled,/\b(insert into|update public|delete from|drop table|alter table)\b/i);
  assert.match(router,/\/shopee\/performance\/stalled/);assert.match(store,/commerce_shopee_performance_stalled_v1/);
  assert.match(view,/\/api\/admin\/commerce\/shopee\/performance\/stalled/);
});
