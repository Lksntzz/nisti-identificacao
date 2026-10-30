import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');

test('categorias visual segue a referência: 5 indicadores, tabelas, gráficos mensais e sazonais',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const css=read('src/commerce-categories-panel.css');
  for(const title of ['Total de unidades','Categoria líder','Subcategoria líder','Maior crescimento','Maior queda','Comparação por categoria','Categoria selecionada','Tabela mensal','Comparação semanal','Produtos e itens do período'])
    assert.ok(ui.includes(title),'Falta painel: '+title);
  assert.match(ui,/function MonthlyBars/);
  assert.match(ui,/function Seasonality/);
  assert.match(ui,/function PairBars/);
  assert.match(ui,/ndb-cp-kpis/);
  assert.match(ui,/selectedCat/);
  assert.match(ui,/selectedSub/);
  assert.match(ui,/selectedWeek/);
  assert.match(ui,/setSelectedWeek\(selectedWeek===w\.week\?null:w\.week\)/);
  assert.match(ui,/category_months/);
  assert.match(ui,/subcategory_months/);
  assert.match(ui,/weekly_subcategories/);
  assert.match(css,/grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:680px\)/);
});
test('somente foto real do catálogo, URLs externas seguras e sem inventar valores',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  assert.match(ui,/^const validImage=/m);
  assert.match(ui,/^const validLink=/m);
  assert.match(ui,/<img src=\{src\} loading="lazy"/);
  assert.match(ui,/rel="noopener noreferrer"/);
  assert.match(ui,/Sem link/);
  assert.match(ui,/Sem base/);
  assert.match(ui,/mon>asOfMonth\?null/);
  assert.match(ui,/ano atual não são tratados como zero/);
  assert.doesNotMatch(ui,/<img[^>]*src=["']https?:\/\//);
  assert.doesNotMatch(ui,/mockData|Math\.random|fakeSales/);
});
test('consulta temporal segura, paginada no detalhamento de produtos e sem gravar vendas',()=>{
  const sql=read('supabase/migrations/20261030183000_commerce_categories_timeline_v1.sql');
  const store=read('src/commerce-supabase-store.js');
  const router=read('src/commerce-admin-router.js');
  assert.match(sql,/commerce_categories_timeline_v1/);
  assert.match(sql,/language sql stable security invoker/);
  assert.match(sql,/revoke all on function public\.commerce_categories_timeline_v1[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_categories_timeline_v1[\s\S]*to service_role/);
  assert.match(sql,/from leading_products q/);
  assert.match(sql,/limit 8/);
  assert.match(sql,/p_week is null or s\.wk=p_week/);
  assert.match(sql,/commerce_product_skus/);
  assert.match(sql,/reference_image_url/);
  assert.doesNotMatch(sql,/\b(delete from|truncate table|insert into|update public\.)\b/i);
  assert.match(store,/commerceCategoriesTimeline/);
  assert.match(store,/commerce_categories_timeline_v1/);
  assert.match(router,/sales-compare\/categories-timeline/);
  assert.match(router,/Filtro temporal de categorias inválido/);
  assert.match(router,/week<1\|\|week>5/);
});


test('investigação completa replica melhor/pior semana e melhores períodos da subcategoria',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const css=read('src/commerce-categories-panel.css');
  assert.match(ui,/Melhor semana \(mês\)/);
  assert.match(ui,/Menor semana \(mês\)/);
  assert.match(ui,/subcats\.map\(sub=>\{/);
  assert.match(ui,/Melhor mês','Melhor semana/);
  assert.match(ui,/id="ndb-cp-products"/);
  assert.match(ui,/Ver produtos/);
  assert.match(css,/\.ndb-cp-view-products/);
});
