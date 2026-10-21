import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const child=fs.readFileSync('src/commerce-sales-evolution.jsx','utf8');
const parent=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const css=fs.readFileSync('src/commerce-view-specific-kpis.css','utf8');
const polish=fs.readFileSync('src/commerce-evolution-polish.css','utf8');

test('Situação das vendas has only three selectable user options',()=>{
  const options=child.match(/const statuses=(\[[^\n]*\]);/);
  assert.ok(options, 'Dropdown must have a finite visible options list');
  assert.equal((options[1].match(/\['/g)||[]).length,3);
  assert.deepEqual([...options[1].matchAll(/\['([A-Z]+)','([^']+)'\]/g)].map(m=>[m[1],m[2]]),[
    ['ZERO','Sem vendas'],['STABLE','Estável'],['RISING','Crescimento']
  ]);
  assert.match(child,/statuses\.map\(\(\[code,label\]\)=><option value=\{code\}/);
  assert.match(child,/<option value="" disabled hidden>Selecionar situação<\/option>/);
  assert.match(child,/value=\{statuses.some\(\(\[code\]\)=>code===status\)\?status:''\}/);
  assert.doesNotMatch(options[1],/FALLING|SOLD|NEW|ALL|INSUFFICIENT|LOW_VOLUME/);
});

test('all-situations overview remains possible without a fourth selectable dropdown option',()=>{
  assert.match(child,/status='ALL'/);
  assert.match(child,/status!=='ALL'&&<button type="button" className="nim-evolution-clear-situation"/);
  assert.match(child,/onClick=\{\(\)=>onStatusChange\('ALL'\)\}/);
  assert.match(polish,/\.nim-evolution-clear-situation/);
});

test('evolution quick filters show exactly the three matching statuses',()=>{
  const block=parent.slice(parent.indexOf('className="nim-kpis nim-kpis-evolution"'),
    parent.indexOf("    {commercialView==='LISTINGS'&&<section",parent.indexOf('className="nim-kpis nim-kpis-evolution"')));
  assert.equal((block.match(/<Kpi tone=/g)||[]).length,3);
  for(const [key,option] of [['zero','ZERO'],['stable','STABLE'],['rising','RISING']]){
    assert.match(block,new RegExp("evolutionCount\\('"+key+"'\\)"));
    assert.match(block,new RegExp("chooseEvolutionStatus\\('"+option+"'\\)"));
  }
  assert.doesNotMatch(block,/evolutionCount\('(falling|sold)'\)/);
  assert.match(css,/\.nim-kpis\.nim-kpis-evolution\{\s*display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(parent,/const evolutionCounts=evolutionSummary\|\|null/);
});
