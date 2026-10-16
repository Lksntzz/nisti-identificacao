import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');
const ui=read('src/commerce-ad-manager.jsx');
const styles=read('src/commerce-ad-manager.css');
const sql=read('supabase/migrations/20261016152000_commerce_listing_manager_v1.sql');

test('performance and ABC controls share a single aligned filter panel',()=>{
  assert.match(ui,/<section className="nim-filter-panel" aria-label="Filtros de situação de vendas, indicadores e Curva ABC">/);
  assert.match(ui,/nim-filter-panel-body/);
  assert.match(ui,/nim-performance-group/);
  assert.match(ui,/nim-abc-group/);
  assert.match(ui,/nim-filter-panel-footer/);
  assert.match(styles,/\.nim-filter-panel-body\{\s*display:grid;grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(styles,/\.nim-abc-group\{\s*border-left:1px solid/);
  assert.match(styles,/\.nim-filter-panel-footer\{/);
});

test('filter status, ABC curve and ABC basis keep their existing actions and selections',()=>{
  assert.match(ui,/SALES_FILTERS\.map\(\(\[code,label\]\)=>/);
  assert.match(ui,/PERFORMANCE_FILTERS\.map\(\(\[code,label\]\)=>/);
  assert.match(ui,/onClick=\{\(\)=>change\(setStatus,code\)\}/);
  assert.match(ui,/aria-pressed=\{status===code\}/);
  assert.match(ui,/onClick=\{\(\)=>change\(setCurve,code\)\}/);
  assert.match(ui,/aria-pressed=\{curve===code\}/);
  assert.match(ui,/value=\{basis\} onChange=\{e=>change\(setBasis,e.target.value\)\}/);
  assert.match(ui,/<option value="REVENUE">Faturamento<\/option>/);
  assert.match(ui,/<option value="UNITS">Unidades vendidas<\/option>/);
});

test('analysis dates appear as understated footer rather than detached paragraph',()=>{
  assert.match(ui,/Período analisado: /);
  assert.match(ui,/periodDate\(data\.period_start\)/);
  assert.match(ui,/periodDate\(data\.period_end\)/);
  assert.match(ui,/nim-filter-panel-warning/);
  assert.match(ui,/Inclui anúncios com variações sem vendas/);
  assert.doesNotMatch(ui,/<p className="nim-coverage">/);
});

test('visual change never modifies zero-variation semantics, listing IDs or scanner data',()=>{
  assert.match(ui,/status==='ZERO'/);
  assert.match(sql,/b.selected_status='ZERO' and c.ready and \(c.units=0 or c.zero_variations>0\)/);
  assert.match(sql,/d.external_listing_id=l.external_listing_id and d.platform_code=l.source_code/);
  assert.doesNotMatch(sql,/insert into public\.products|update public\.products|delete from public\.products/);
  assert.match(styles,/@media\(max-width:880px\)/);
});

test('sales status and performance indicators are displayed separately',()=>{
  assert.match(ui,/<th>Vendas<\/th><th>Indicadores<\/th>/);
  assert.match(ui,/<td><Situation item=\{item\}\/><\/td>/);
  assert.match(ui,/<td><Indicators item=\{item\}\/><\/td>/);
  assert.match(ui,/listingSalesSituation\(item\)/);
  assert.match(ui,/listingPerformanceIndicators\(item\)/);
});
