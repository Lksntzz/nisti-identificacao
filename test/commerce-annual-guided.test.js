import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');

test('Comparação Anual reformulada mantém a navegação do GA e o Painel Categorias',()=>{
  const entry=read('src/commerce-admin-app-v2.jsx');
  const annual=read('src/commerce-annual-compare.jsx');
  const guided=read('src/commerce-annual-guided.jsx');
  for(const label of ['Painel Comercial','Comparação anual','Categorias'])assert.ok(entry.includes(label));
  assert.match(annual,/GuidedAnnualCompare/);
  for(const label of ['Unidades no ano','Meses em alta \/ queda','Maior ganho \/ maior perda','Produtos em queda no mês',
    'Evolução mensal de unidades vendidas','Investigação do mês','Desempenho semanal','Produtos da semana',
    'Mais vendidos','Mais cresceram','Mais caíram','Sem histórico','Ver dias','Gráfico','Tabela'])
    assert.ok(guided.includes(label),'Rótulo ausente: '+label);
  assert.doesNotMatch(guided,/Projeção de |Preço médio por unidade|Receita /);
});

test('interações usam séries e produtos reais, nunca resultados inventados',()=>{
  const guided=read('src/commerce-annual-guided.jsx');
  assert.match(guided,/fetchCommercialManager\(path/);
  assert.match(guided,/annual-days/);
  assert.match(guided,/cleanRows\(dayState\.data\?\.days\)\.filter/);
  assert.match(guided,/d\.cur==null\?'—'/);
  assert.match(guided,/d\.base==null\?'—'/);
  assert.match(guided,/annual-period-products/);
  assert.match(guided,/setWeek\(n\)/);
  assert.match(guided,/setProductTab\('down'\)/);
  assert.match(guided,/statusOf\(r\)/);
  assert.match(guided,/Sem vendas registradas em /);
  assert.doesNotMatch(guided,/08\/06\s+165\s+210/);
});

test('rota de dias valida plataforma, período, anos e usa RPC somente leitura',()=>{
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

test('períodos, carregamento cancelável e classificação sem inventar lançamento',()=>{
  const g=read('src/commerce-annual-guided.jsx');
  assert.match(g,/PeriodPicker/);
  assert.match(g,/periods=\{\[7,30,60,90\]\}/);
  assert.match(g,/monthData\.platform===filters\.platform/);
  assert.match(g,/controller\.abort\(\)/);
  assert.match(g,/mesmo intervalo de /);
  assert.match(g,/data de criação não confirmada/);
  assert.match(g,/não comprova que o anúncio seja novo/);
  assert.match(g,/ranking de quedas/);
});
