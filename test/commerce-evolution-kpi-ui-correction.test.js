import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const evolution=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-polish.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261020213000_commerce_evolution_sold_filter_kpis_v1.sql','utf8');

test('evolution KPIs use actual child response, not a fictitious nested kpis.kpis',()=>{
  assert.match(evolution,/onSummary\(body\?\.kpis\|\|null\)/);
  assert.match(manager,/const evolutionCounts=evolutionSummary\|\|null;/);
  assert.doesNotMatch(manager,/evolutionSummary\?\.kpis/);
  assert.match(manager,/const evolutionReady=Boolean\(evolutionCounts\)/);
  for(const key of ['falling','zero','sold','rising']){
    assert.match(manager,new RegExp("evolutionCount\\('"+key+"'\\)"));
    assert.match(sql,new RegExp("'"+key+"',\\(select count\\(\\*\\) from searched"));
  }
  assert.match(manager,/evolutionReady\?num\(evolutionCounts\[key\]\):'—'/);
});

test('commercial view navigation precedes its four filtered KPIs',()=>{
  const nav=manager.indexOf('<nav className="nim-commercial-views"');
  const kpi=manager.indexOf('className="nim-kpis nim-kpis-evolution"');
  const filter=manager.indexOf('<CommerceSalesEvolution platform={platform}');
  assert.ok(nav>0&&nav<kpi&&kpi<filter);
  assert.match(css,/\.nim-manager \.nim-kpis-evolution \.nim-kpi\{min-height:92px/);
});

test('evolution rows show verified current and prior units without inferred listing sales',()=>{
  assert.match(evolution,/Unidades · atual \/ anterior/);
  assert.match(evolution,/\{num\(item\.current_units\)\} un\./);
  assert.match(evolution,/Anterior: \{num\(item\.previous_units\)\} un\./);
  assert.match(evolution,/data\.previous_start/);
  assert.match(evolution,/SKU\(s\)\/modelo\(s\) no filtro/);
  assert.match(evolution,/Math\.min\(offset\+rows\.length,total\)/);
  assert.match(evolution,/status!=='ALL'/);
  assert.match(evolution,/item\.listing_id\?'Anúncio '/);
  assert.match(css,/\.nim-manager \.nim-evolution-quick-stats small/);
});

test('methodology remains accessible but no longer occupies permanent height',()=>{
  assert.match(evolution,/<details className="nim-evolution-methodology">/);
  assert.match(evolution,/<summary>Como o NISTI calcula crescimento e queda\?<\/summary>/);
  assert.match(evolution,/Não criamos promoções automaticamente/);
  assert.match(evolution,/cobertura incompleta/i);
  assert.match(css,/\.nim-manager \.nim-evolution-methodology>summary/);
  assert.match(css,/@media\(max-width:600px\)/);
});
