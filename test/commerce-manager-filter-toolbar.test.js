import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');
const ui=read('src/commerce-ad-manager.jsx');
const evidence=read('src/commerce-ad-evidence.js');
const styles=read('src/commerce-ad-manager.css');
const sql=read('supabase/migrations/20261016152000_commerce_listing_manager_v1.sql');

test('sales and ABC controls share a compact, aligned filter panel',()=>{
  assert.match(ui,/<section className="nim-filter-panel" aria-label="Filtros de plataforma, anúncio, período, situação de vendas e Curva ABC">/);
  assert.match(ui,/nim-filter-panel-body/);
  assert.match(ui,/nim-performance-group/);
  assert.match(ui,/nim-abc-group/);
  assert.match(ui,/nim-filter-panel-footer/);
  assert.match(styles,/\.nim-filter-panel-body\{\s*display:grid;grid-template-columns:minmax\(260px,1fr\) auto/);
  assert.match(styles,/\.nim-abc-group\{border-left:1px solid/);
  assert.match(styles,/\.nim-filter-panel-footer\{/);
});

test('filter status, ABC curve and ABC basis keep their existing actions and selections',()=>{
  assert.match(ui,/SALES_FILTERS\.map\(\(\[code,label\]\)=>/);
  assert.match(ui,/const SALES_FILTERS=\[\['ALL','Todos'\],\['SOLD','Com vendas'\],\['ZERO','Sem vendas'\]\];/);
  assert.doesNotMatch(ui,/PERFORMANCE_FILTERS|listingPerformanceIndicators/);
  assert.match(ui,/onClick=\{\(\)=>change\(setStatus,code\)\}/);
  assert.match(ui,/aria-pressed=\{status===code\}/);
  assert.match(ui,/onClick=\{\(\)=>change\(setCurve,code\)\}/);
  assert.match(ui,/aria-pressed=\{curve===code\}/);
  assert.match(ui,/value=\{basis\} onChange=\{e=>change\(setBasis,e.target.value\)\}/);
  assert.match(ui,/<option value="REVENUE">Faturamento<\/option>/);
  assert.match(ui,/<option value="UNITS">Unidades vendidas<\/option>/);
});

test('analysis dates appear as understated footer rather than detached paragraph',()=>{
  assert.match(ui,/importedWindowDescription\(data,days,periodDate\)/);
  assert.match(evidence,/Período analisado: /);
  assert.match(evidence,/formatDate\(data\.period_start\)/);
  assert.match(evidence,/formatDate\(data\.period_end\)/);
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

test('o Gestor exibe apenas Todos, Com vendas e Sem vendas, sem indicadores',()=>{
  assert.match(ui,/const SALES_FILTERS=\[\['ALL','Todos'\],\['SOLD','Com vendas'\],\['ZERO','Sem vendas'\]\];/);
  assert.match(ui,/<th>Vendas<\/th>/);
  assert.match(ui,/<td><Situation item=\{item\} days=\{days\}\/><\/td>/);
  assert.match(ui,/listingSalesSituation\(item\)/);
  assert.doesNotMatch(ui,/<th>Indicadores<\/th>|<Indicators|PERFORMANCE_FILTERS|listingPerformanceIndicators|Em crescimento|Poucas vendas/);
  assert.doesNotMatch(styles,/\.nim-indicators|\.nim-status\.rising|\.nim-status\.low/);
});

test('a tabela tem sete colunas e o filtro sem vendas preserva variações sem saída',()=>{
  assert.match(ui,/colSpan=\{7\}/);
  assert.doesNotMatch(ui,/colSpan=\{8\}/);
  assert.match(ui,/zeroFilter=\{status==='ZERO'\}/);
  assert.match(ui,/variations\.filter\(v=>v\.units===0\)/);
  assert.match(sql,/b.selected_status='ZERO' and c.ready and \(c.units=0 or c.zero_variations>0\)/);
});

test('todos os filtros aparecem uma única vez no painel compacto',()=>{
  const start=ui.indexOf('<section className="nim-filter-panel"');
  const end=ui.indexOf('{error&&<div className="nim-error"',start);
  const panel=ui.slice(start,end);
  assert.match(panel,/<div className="nim-filter-top">/);
  assert.match(panel,/nim-filter-panel-body'\+\(shopeeTrendAvailable\?' nim-has-trend':''\)/);
  assert.match(panel,/<div className="nim-filter-panel-footer">/);
  const sections=['Plataforma','Buscar anúncio ou ID','Período','Mês personalizado','Limpar filtros','Situação de vendas','Curva ABC'];
  for(const label of sections){
    assert.ok(panel.includes(label),label+' deve aparecer no painel');
  }
  assert.equal((ui.match(/onClick=\{clear\}/g)||[]).length,1);
  assert.equal((panel.match(/className="nim-filter-field/g)||[]).length,4);
  assert.equal((panel.match(/className="nim-filter-reset"/g)||[]).length,0);
  assert.match(panel,/className="nim-soft-button nim-filter-reset" onClick=\{clear\}/);
  assert.ok(panel.indexOf('nim-filter-top')<panel.indexOf('nim-filter-panel-body'));
  assert.doesNotMatch(ui,/nim-filterbar-integrated|nim-unified-period-controls|nim-performance-line/);
  assert.doesNotMatch(styles,/\.nim-filterbar|\.nim-unified-period-controls|\.nim-performance-line/);
});

test('a grade organiza filtros sem grandes vazios e preserva disposição responsiva',()=>{
  assert.match(styles,/\.nim-filter-top\{\s*display:grid;/);
  assert.match(styles,/grid-template-columns:minmax\(165px,1fr\)/);
  assert.match(styles,/@media\(max-width:1180px\)/);
  assert.match(styles,/@media\(max-width:920px\)/);
  assert.match(styles,/\.nim-filter-search\{grid-column:span 2\}/);
  assert.match(styles,/\.nim-abc-controls\{display:flex/);
});
