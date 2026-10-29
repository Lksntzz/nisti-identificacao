import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(path,'utf8');

test('a comparação guiada preserva módulos e navegação do painel comercial',()=>{
  const entry=read('src/commerce-admin-app-v2.jsx');
  const annual=read('src/commerce-annual-compare.jsx');
  const guided=read('src/commerce-annual-guided.jsx');
  for(const label of ['Painel Comercial','Comparação anual','Categorias'])assert.ok(entry.includes(label));
  assert.match(annual,/GuidedAnnualCompare/);
  for(const label of ['Unidades no ano','Últimos 28 dias','Projeção de ','Preço médio por unidade',
    'Comparação mensal','Investigação','Semanas do mês','Comparação diária',
    'Ver','matriz semanal completa','campeões do mês','Séries móveis','Barras','Tabela','Gráfico'])
    assert.ok(guided.includes(label),'Rótulo ausente: '+label);
});

test('a tabela diaria usa fonte de dados, nao valores ilustrativos',()=>{
  const guided=read('src/commerce-annual-guided.jsx');
  assert.match(guided,/fetchCommercialManager\(url/);
  assert.match(guided,/data\.days\.filter/);
  assert.match(guided,/d\.cur==null\?'—'/);
  assert.match(guided,/d\.base==null\?'—'/);
  assert.doesNotMatch(guided,/08\/06\s+165\s+210/);
});

test('rota de dias valida plataforma, periodo, anos e usa RPC read-only',()=>{
  const router=read('src/commerce-admin-router.js');
  const store=read('src/commerce-supabase-store.js');
  const sql=read('supabase/migrations/20261029170000_commerce_annual_days_v1.sql');
  assert.match(router,/sales-compare\/annual-days/);
  assert.match(router,/base!==year-1/);
  assert.match(store,/commerce_annual_days_v1/);
  assert.match(sql,/language sql stable/);
  assert.match(sql,/revoke all on function public\.commerce_annual_days_v1[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_annual_days_v1[\s\S]*to service_role/);
  assert.match(sql,/left join scoped cur/);
  assert.match(sql,/left join scoped prev/);
  assert.doesNotMatch(sql,/\b(insert into|update public\.|delete from|truncate table)\b/i);
});

test('modes de detalhe e periodos preservam separacao entre calendario e series moveis',()=>{
  const guided=read('src/commerce-annual-guided.jsx');
  assert.match(guided,/mesma data do calendário/);
  assert.match(guided,/364 dias antes/);
  assert.match(guided,/monthData\.platform===filters\.platform/);
  assert.match(guided,/controller\.abort\(\)/);
});
