import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groupReport,periodLabel} from '../src/ga/commerce-sales-report-logic.js';

test('agrupa por plataforma, separa situações e conta anúncio x variação', () => {
  const rows=[
    {platform:'SHOPEE',scope:'VARIACAO',situation:'PAROU',title:'B',days_since:10},
    {platform:'SHOPEE',scope:'ANUNCIO',situation:'PAROU',title:'A',days_since:5},
    {platform:'SHOPEE',scope:'ANUNCIO',situation:'SEM_VENDAS',title:'C'},
    {platform:'ML_NOVO',scope:'ANUNCIO',situation:'SEM_VENDAS',title:'D'}
  ];
  const g=groupReport(rows);
  assert.deepEqual(g.map(x=>x.code),['SHOPEE','ML_NOVO']);
  assert.equal(g[0].anuncios,2);assert.equal(g[0].variacoes,1);
  assert.equal(g[0].parou[0].scope,'ANUNCIO');
  assert.equal(groupReport(null).length,0);
});
test('rótulo do período', () => {
  assert.equal(periodLabel(30),'Nenhuma venda nos últimos 30 dias');
  assert.equal(periodLabel(90),'Nenhuma venda nos últimos 90 dias');
});
test('rota, store, botão e impressão existem', () => {
  const r=fs.readFileSync('src/ga/commerce-admin-router.js','utf8');
  assert.match(r,/sales-dashboard\/report-no-sales/);
  assert.match(fs.readFileSync('src/ga/commerce-supabase-store.js','utf8'),/commerce_sales_report_no_sales_v1/);
  assert.match(fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8'),/Relatório de anúncios sem vendas/);
  assert.match(fs.readFileSync('src/ga/commerce-sales-report.css','utf8'),/@media print/);
});

import {topLongest} from '../src/ga/commerce-sales-report-logic.js';
test('resumo: mais tempo sem vender primeiro e nunca vendeu antes de todos', () => {
  const rows=[{title:'a',days_since:5},{title:'b',days_since:90},{title:'c',days_since:null},...Array.from({length:12},(_,i)=>({title:'x'+i,days_since:i}))];
  const t=topLongest(rows);
  assert.equal(t.length,10);assert.equal(t[0].title,'c');assert.equal(t[1].title,'b');
});
test('relatório começa resumido e tem botão da lista completa', () => {
  const j=fs.readFileSync('src/ga/commerce-sales-report.jsx','utf8');
  assert.match(j,/useState\(false\)/);assert.match(j,/Ver lista completa/);assert.match(j,/topLongest\(it\)/);
});

import {reportToCsv} from '../src/ga/commerce-sales-report-logic.js';
test('planilha: BOM, separador ; e aspas escapadas', () => {
  const c=reportToCsv([{platform:'SHOPEE',situation:'PAROU',scope:'VARIACAO',external_id:'1',title:'Faixa "A"; B',variation_name:'X',sku:'S',last_sale:'2026-01-01',days_since:9,units_ever:4,url:'u'}]);
  assert.ok(c.startsWith('﻿Plataforma;'));
  assert.match(c,/Shopee;Sim;VARIAÇÃO;1;"Faixa ""A""; B";X;S;/);
});

import {groupListings} from '../src/ga/commerce-sales-report-logic.js';
test('agrupa variações do mesmo anúncio em uma linha', () => {
  const rows=[
    {platform:'SHOPEE',situation:'PAROU',scope:'VARIACAO',external_id:'9',title:'Kit',variation_name:'14',days_since:400,units_ever:5},
    {platform:'SHOPEE',situation:'PAROU',scope:'VARIACAO',external_id:'9',title:'Kit',variation_name:'11',days_since:300,units_ever:7},
    {platform:'SHOPEE',situation:'PAROU',scope:'ANUNCIO',external_id:'1',title:'Solo',days_since:null}
  ];
  const g=groupListings(rows);
  assert.equal(g.length,2);
  assert.deepEqual(g[0].vars,['14','11']);assert.equal(g[0].days_since,300);assert.equal(g[0].units_ever,7);
});

test('impressão não trava a orientação da folha', () => {
  assert.doesNotMatch(fs.readFileSync('src/ga/commerce-sales-report.css','utf8'),/size:\s*A4\s+landscape/);
});

test('relatório: lista todo anúncio sem venda no período e permite trocar o período', () => {
  const j=fs.readFileSync('src/ga/commerce-sales-report.jsx','utf8');
  assert.match(j,/nenhuma venda nos últimos/);assert.match(j,/PERIOD_CHOICES/);
  assert.doesNotMatch(j,/Vendia e parou/);
  const g=groupReport([{platform:'SHOPEE',scope:'ANUNCIO',situation:'PAROU'},{platform:'SHOPEE',scope:'ANUNCIO',situation:'SEM_VENDAS'},{platform:'SHOPEE',scope:'VARIACAO',situation:'PAROU'}]);
  assert.equal(g[0].zero.length,2);assert.equal(g[0].vars.length,1);
});

test('mesmo anúncio com variações em situações diferentes vira uma linha só', () => {
  const g=groupListings([
    {platform:'SHOPEE',situation:'SEM_VENDAS',scope:'VARIACAO',external_id:'7',title:'T',variation_name:'a',days_since:null,units_ever:0},
    {platform:'SHOPEE',situation:'PAROU',scope:'VARIACAO',external_id:'7',title:'T',variation_name:'b',days_since:440,units_ever:5}]);
  assert.equal(g.length,1);assert.equal(g[0].vars.length,2);assert.equal(g[0].days_since,440);
});

import {filterStalled} from '../src/ga/commerce-sales-report-logic.js';
test('filtro: 90 dias sem venda; padrão só quem completou 90 dias agora', () => {
  const rows=[{days_since:40},{days_since:90},{days_since:96},{days_since:97},{days_since:200},{days_since:608},{days_since:null}];
  assert.deepEqual(filterStalled(rows,90,false).map(r=>r.days_since),[90,96]);
  assert.equal(filterStalled(rows,90,true).length,7);
});

test('relatório mostra SKU e esconde textos explicativos na impressão',()=>{
  const ui=fs.readFileSync('src/ga/commerce-sales-report.jsx','utf8'),css=fs.readFileSync('src/ga/commerce-sales-report.css','utf8');
  assert.match(ui,/<th>SKU<\/th>/);
  assert.match(ui,/g\.skus\.join/);
  assert.match(css,/@media print\{\s*\.nsr-explain,\.nsr-wide/);
  const g=groupListings([{platform:'ML',scope:'VARIACAO',external_id:'1',sku:'A'},{platform:'ML',scope:'VARIACAO',external_id:'1',sku:'B, A'}]);
  assert.deepEqual(g[0].skus,['A','B']);
});
