import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const view=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-integrated.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');

test('anúncios e evolução possuem interfaces próprias e apenas duas opções de navegação',()=>{
  const nav=manager.slice(manager.indexOf('<nav className="nim-commercial-views"'),manager.indexOf('</nav>'));
  assert.equal((nav.match(/<button type="button"/g)||[]).length,2);
  assert.match(manager,/nim-kpis-listings/);
  assert.match(manager,/CommerceEvolutionIntegrated/);
  assert.doesNotMatch(nav,/Variações 30\/60\/90/);
  assert.doesNotMatch(manager,/value=\{28\}|value=\{41\}/);
});

test('cards de evolução e seletor usam o mesmo status por anúncio inteiro',()=>{
  for(const status of ['ZERO','STABLE','RISING'])
    assert.match(view,new RegExp("'"+status+"'"));
  assert.match(view,/onClick=\{\(\)=>onStatusChange\(card\.id\)\}/);
  assert.match(view,/onChange=\{e=>onStatusChange\(e\.target\.value\)\}/);
  assert.match(view,/status,limit:String\(PAGE\),offset:String\(offset\)/);
  assert.match(sql,/and \(i\.status='ALL' or a\.situation=i\.status\)/);
  assert.match(manager,/onClick=\{\(\)=>change\(setStatus,status==='SOLD'\?'ALL':'SOLD'\)\}/);
  assert.match(manager,/Totais financeiros importados/);
});

test('evolução apresenta anúncio expansível, séries reais e variações 30 60 90 com layout responsivo',()=>{
  assert.match(view,/aria-expanded=\{expanded\}/);
  assert.match(view,/function WeeklyChart/);
  assert.match(view,/function VariationTable/);
  assert.match(view,/WINDOWS=\[30,60,90\]/);
  assert.match(view,/identified_units/);
  assert.match(view,/Os resultados são calculados somente sobre os registros importados/);
  assert.match(css,/@media\(max-width:560px\)/);
  assert.match(css,/@media\(max-width:850px\)/);
});
