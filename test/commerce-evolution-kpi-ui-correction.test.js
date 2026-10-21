import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const view=fs.readFileSync('src/commerce-evolution-integrated.jsx','utf8');
const sql=fs.readFileSync('supabase/migrations/20261021220000_commerce_evolution_ads_v1.sql','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');

test('KPIs da evolução vêm da mesma resposta de anúncios, não da contagem de SKUs',()=>{
  assert.match(store,/commerce_evolution_ads_v1/);
  assert.match(view,/const kpis=report\?\.kpis\|\|\{\}/);
  for(const key of ['zero','stable','rising','total']){
    assert.match(view,new RegExp("value:kpis\\."+key));
    assert.match(sql,new RegExp("'"+key+"',\\(select count\\(\\*\\) from classified"));
  }
  assert.doesNotMatch(manager,/evolutionSummary\?\.kpis/);
});

test('a navegação principal antecede a nova evolução integrada',()=>{
  assert.ok(manager.indexOf('<nav className="nim-commercial-views"')>0);
  assert.ok(manager.indexOf('<nav className="nim-commercial-views"') <
    manager.indexOf('<CommerceEvolutionIntegrated platform={platform}'));
  assert.doesNotMatch(manager,/commercialView==='VARIATIONS'/);
});

test('sem vendas significa anúncio inteiro e tendências exigem duas janelas completas',()=>{
  assert.match(sql,/when a\.unknown_variations=0 and a\.zero_variations=a\.variation_count then 'ZERO'/);
  assert.match(sql,/a\.previous_unknown=0/);
  assert.match(sql,/a\.previous_units>=3/);
  assert.match(sql,/a\.identified_units>=a\.previous_units\*1\.2/);
  assert.match(view,/Estável e Crescimento comparam o período selecionado ao período anterior de igual duração/);
});

test('cobertura incompleta permanece pendente',()=>{
  assert.match(view,/Não é possível afirmar vendas zero/);
  assert.match(view,/Sem cobertura completa, semanas sem registro não comprovam ausência de vendas/);
  assert.match(view,/sku|SKU/);
});
