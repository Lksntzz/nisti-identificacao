import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const view=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const css=fs.readFileSync('src/commerce-evolution-integrated.css','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');

test('Painel Comercial tem so a lista de anuncios (evolucao de vendas ficou no Dashboard)',()=>{
  assert.doesNotMatch(manager,/nim-commercial-views/);
  assert.doesNotMatch(manager,/CommerceEvolutionIntegrated/);
  assert.match(manager,/nim-kpis-listings/);
  assert.doesNotMatch(manager,/value=\{28\}|value=\{41\}/);
});

test('cards de evolução e seletor usam o mesmo status por anúncio inteiro',()=>{
  for(const status of ['ZERO','STABLE','RISING'])
  assert.match(sql,/and \(i\.status='ALL' or a\.situation=i\.status\)/);
  assert.match(manager,/onClick=\{\(\)=>change\(setStatus,status==='SOLD'\?'ALL':'SOLD'\)\}/);
  assert.match(manager,/Totais financeiros importados/);
});

