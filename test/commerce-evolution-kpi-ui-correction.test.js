import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');

test('Painel Comercial nao tem mais navegacao de abas nem evolucao integrada',()=>{
  assert.doesNotMatch(manager,/<nav className="nim-commercial-views"/);
  assert.doesNotMatch(manager,/<CommerceEvolutionIntegrated/);
  assert.doesNotMatch(manager,/commercialView==='VARIATIONS'/);
});

test('sem vendas significa anúncio inteiro e tendências exigem duas janelas completas',()=>{
  assert.match(sql,/when a\.unknown_variations=0 and a\.zero_variations=a\.variation_count then 'ZERO'/);
  assert.match(sql,/a\.previous_unknown=0/);
  assert.match(sql,/a\.previous_units>=3/);
  assert.match(sql,/a\.identified_units>=a\.previous_units\*1\.2/);
});

