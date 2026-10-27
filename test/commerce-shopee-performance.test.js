import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {parseShopeePerformanceSheets,periodFromFilename} from '../src/commerce-shopee-performance-reader.js';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261026160000_commerce_shopee_performance_v1.sql');
const router=read('src/commerce-admin-router.js');
const center=read('src/commerce-import-center.jsx');
const cell=read('src/commerce-price-signal.jsx');

const HEAD=['ID do Item','Produto','Status Atual do Item','ID da Variação','Impressão do Produto','Cliques Por Produto','Visitantes do Produto (Visita)','Pedido Feito','Unidades (Pedido realizado)','Vendas (Pedido realizado) (BRL)'];
const sheet=data=>[{sheet:'Produtos com Melhor Desempenho',data}];

test('reader keeps one row per listing, ignores variation rows and parses pt-BR numbers',()=>{
  const out=parseShopeePerformanceSheets(sheet([HEAD,
    ['41380126507','Caderneta','Normal','-','1.074.846','33223','5','1385','1414','45.001,40'],
    ['41380126507','Caderneta','Normal','410795207265','-','-','-','-','25','1.000,00'],
    ['56262008605','Safari','Normal','-','10','2','1','1','1','39,90']]),'parentskudetail.20260801_20260831.xlsx');
  assert.equal(out.rows.length,2);
  assert.equal(out.rows[0].impressions,1074846);
  assert.equal(out.rows[0].revenue,45001.4);
  assert.equal(out.days,31);
  assert.deepEqual([out.report.start,out.report.end],['2026-08-01','2026-08-31']);
  assert.equal(out.totals.units,1415);
});
test('reader rejects filenames without period, long periods and unknown sheets',()=>{
  assert.throws(()=>periodFromFilename('relatorio.xlsx'),/período/i);
  assert.throws(()=>periodFromFilename('parentskudetail.20260101_20261231.xlsx'),/1 a 93 dias/);
  assert.throws(()=>parseShopeePerformanceSheets(sheet([['a','b'],['1','2']]),'parentskudetail.20260801_20260831.xlsx'),/reconheci/);
});
test('SQL is isolated, idempotent by sha256, service_role only and never touches sales',()=>{
  assert.match(sql,/sha256 text not null unique/);
  assert.match(sql,/on conflict \(sha256\) do nothing/);
  assert.match(sql,/revoke all on function public\.commerce_shopee_performance_import_v1/);
  assert.match(sql,/grant execute on function public\.commerce_listing_performance_diagnosis_v1\(bigint\[\]\) to service_role/);
  assert.doesNotMatch(sql,/(insert into|update|delete from) public\.commerce_(sales|current_sales|shopee_sales)/i);
  assert.match(sql,/rp\.period_end<c\.ps/);
});
test('routes, import tab and cause text are wired and never claim proof',()=>{
  assert.ok(router.includes("/shopee/performance/reports")&&router.includes('/listings/manager/performance-diagnosis'));
  assert.ok(center.includes("'performance'")&&read('src/commerce-performance-import.jsx').includes('<CommerceShopeePerformanceImport'));
  assert.match(cell,/não prova o motivo/);
  assert.ok(cell.includes('Menos impressões')&&cell.includes('Converte menos'));
});
