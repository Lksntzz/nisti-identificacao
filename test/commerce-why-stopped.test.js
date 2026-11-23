import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {causeOf,priceChange,priceRose,steps,filterItems,reportIsStale,WHY_DAYS} from '../src/ga/commerce-why-stopped-logic.js';

const sql=fs.readFileSync('supabase/migrations/20261123170000_commerce_shopee_why_stopped_v1.sql','utf8');
const router=fs.readFileSync('src/ga/commerce-admin-router.js','utf8');
const store=fs.readFileSync('src/ga/commerce-supabase-store.js','utf8');
const app=fs.readFileSync('src/ga/commerce-admin-app-v2.jsx','utf8');
const view=fs.readFileSync('src/ga/commerce-why-stopped.jsx','utf8');
const dash=fs.readFileSync('src/ga/commerce-dashboard.jsx','utf8');

const items=[
  {item_id:'1',cause:'VISIBILIDADE',imp_change:-40,ctr_change:-5,conv_change:2,price_prev:30,price_cur:30},
  {item_id:'2',cause:'CONVERSAO',imp_change:10,ctr_change:3,conv_change:-42,price_prev:30,price_cur:34},
  {item_id:'3',cause:'SEM_SINAL',price_prev:30,price_cur:31},
  {item_id:'4',cause:'SEM_RELATORIO',price_prev:0,price_cur:null}
];
test('motivos conhecidos e fallback',()=>{
  assert.equal(causeOf('CLIQUE').label,'Perdeu cliques');
  assert.equal(causeOf('XYZ').label,'Sem sinal no relatório');
  assert.deepEqual(WHY_DAYS,[7,14,30]);
});
test('preço: variação e alta de 10% ou mais',()=>{
  assert.equal(Math.round(priceChange(items[1])*10)/10,13.3);
  assert.equal(priceRose(items[1]),true);assert.equal(priceRose(items[2]),false);assert.equal(priceChange(items[3]),null);
});
test('etapas marcam a principal e as que caíram 20% ou mais',()=>{
  const s=steps(items[0]);
  assert.deepEqual(s.map(x=>x.key),['imp','ctr','conv']);
  assert.equal(s[0].main,true);assert.equal(s[0].bad,true);assert.equal(s[1].bad,false);
  assert.equal(steps(items[1])[2].main,true);
});
test('filtros por motivo, sem diagnóstico e preço',()=>{
  assert.equal(filterItems(items,'all').length,4);
  assert.deepEqual(filterItems(items,'VISIBILIDADE').map(r=>r.item_id),['1']);
  assert.deepEqual(filterItems(items,'SEM').map(r=>r.item_id),['3','4']);
  assert.deepEqual(filterItems(items,'PRICE').map(r=>r.item_id),['2']);
  assert.deepEqual(filterItems(null,'all'),[]);
});
test('aviso quando o relatório é anterior à queda',()=>{
  assert.equal(reportIsStale({report_after:{end:'2026-11-04'},window:{cur_start:'2026-11-09'}}),true);
  assert.equal(reportIsStale({report_after:{end:'2026-11-20'},window:{cur_start:'2026-11-09'}}),false);
  assert.equal(reportIsStale({}),false);
});
test('SQL só leitura, só ativos, dias validados, sem sobreposição de relatórios',()=>{
  assert.match(sql,/create or replace function public\.commerce_shopee_why_stopped_v1/);
  assert.match(sql,/stable security invoker set search_path=public/);
  assert.match(sql,/listing_status='ACTIVE'/);
  assert.match(sql,/p_days in \(7,14,30\)/);
  assert.match(sql,/period_end<\(select period_start from rb\)/);
  assert.match(sql,/max\(sale_date\)-1/);
  assert.match(sql,/from public,anon,authenticated/);assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm,''),/\b(insert into|update public|delete from|drop table|alter table)\b/i);
});
test('rota, store, menu abaixo de Categorias e tela antiga removida',()=>{
  assert.match(router,/\/shopee\/why-stopped/);assert.match(router,/\[7,14,30\]\.includes\(days\)/);
  assert.match(store,/commerce_shopee_why_stopped_v1/);
  assert.match(app,/\{ id: 'categories', label: 'Categorias' \},\s*\{ id: 'why', label: 'Por que parou', view: 'why' \}/);
  assert.match(app,/activeView === 'why' && <CommerceWhyStopped \/>/);
  assert.match(view,/\/api\/admin\/commerce\/shopee\/why-stopped\?days=/);
  assert.doesNotMatch(dash,/ShopeePerformanceView/);
  assert.doesNotMatch(router,/performance\/(overview|stalled|falling)/);
  assert.equal(fs.existsSync('src/ga/commerce-shopee-performance-view.jsx'),false);
});
test('card enxuto: detalhe recolhido por padrão e rótulos curtos nas etapas',()=>{
  assert.match(view,/useState\(false\)/);assert.match(view,/aria-expanded=\{open\}/);
  assert.match(view,/\{open&&<div className="nwy-detail">/);
  assert.doesNotMatch(view,/nwy-steps|nwy-low|nwy-check/);
  assert.deepEqual(steps({cause:'VISIBILIDADE'}).map(s=>s.short),['Impressões','CTR','Conversão']);
});
