import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groupReport,periodLabel} from '../src/commerce-sales-report-logic.js';

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
  assert.equal(periodLabel(30,''),'Últimos 30 dias');
  assert.equal(periodLabel(0,''),'Todo o histórico');
  assert.equal(periodLabel(0,'2026-03'),'03/2026');
  assert.equal(periodLabel(0,'2026'),'Ano 2026');
});
test('rota, store, botão e impressão existem', () => {
  const r=fs.readFileSync('src/commerce-admin-router.js','utf8');
  assert.match(r,/sales-dashboard\/report-no-sales/);
  assert.match(fs.readFileSync('src/commerce-supabase-store.js','utf8'),/commerce_sales_report_no_sales_v1/);
  assert.match(fs.readFileSync('src/commerce-dashboard.jsx','utf8'),/Relatório de anúncios sem vendas/);
  assert.match(fs.readFileSync('src/commerce-sales-report.css','utf8'),/@media print/);
});

import {topLongest} from '../src/commerce-sales-report-logic.js';
test('resumo: mais tempo sem vender primeiro e nunca vendeu antes de todos', () => {
  const rows=[{title:'a',days_since:5},{title:'b',days_since:90},{title:'c',days_since:null},...Array.from({length:12},(_,i)=>({title:'x'+i,days_since:i}))];
  const t=topLongest(rows);
  assert.equal(t.length,10);assert.equal(t[0].title,'c');assert.equal(t[1].title,'b');
});
test('relatório começa resumido e tem botão da lista completa', () => {
  const j=fs.readFileSync('src/commerce-sales-report.jsx','utf8');
  assert.match(j,/useState\(false\)/);assert.match(j,/Ver lista completa/);assert.match(j,/topLongest\(groupListings\(rows\)\)/);
});

import {reportToCsv} from '../src/commerce-sales-report-logic.js';
test('planilha: BOM, separador ; e aspas escapadas', () => {
  const c=reportToCsv([{platform:'SHOPEE',situation:'PAROU',scope:'VARIACAO',external_id:'1',title:'Faixa "A"; B',variation_name:'X',sku:'S',last_sale:'2026-01-01',days_since:9,units_ever:4,url:'u'}]);
  assert.ok(c.startsWith('﻿Plataforma;'));
  assert.match(c,/Shopee;Vendia e parou;VARIAÇÃO;1;"Faixa ""A""; B";X;S;/);
});

import {groupListings} from '../src/commerce-sales-report-logic.js';
test('agrupa variações do mesmo anúncio em uma linha', () => {
  const rows=[
    {platform:'SHOPEE',situation:'PAROU',scope:'VARIACAO',external_id:'9',title:'Kit',variation_name:'14',days_since:400,units_ever:5},
    {platform:'SHOPEE',situation:'PAROU',scope:'VARIACAO',external_id:'9',title:'Kit',variation_name:'11',days_since:300,units_ever:7},
    {platform:'SHOPEE',situation:'PAROU',scope:'ANUNCIO',external_id:'1',title:'Solo',days_since:null}
  ];
  const g=groupListings(rows);
  assert.equal(g.length,2);
  assert.deepEqual(g[0].vars,['14','11']);assert.equal(g[0].days_since,400);assert.equal(g[0].units_ever,7);
});
