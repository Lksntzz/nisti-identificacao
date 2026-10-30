import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');

test('categorias visual segue a referência: 5 indicadores, tabelas, gráficos mensais e sazonais',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const css=read('src/commerce-categories-panel.css');
  for(const title of ['Total de unidades','Categoria líder','Coleção líder','Coleção em crescimento','Coleção em queda','Comparação por categoria','Categoria selecionada','Tabela mensal','Comparação semanal','Produtos e itens do período'])
    assert.ok(ui.includes(title),'Falta painel: '+title);
  assert.match(ui,/function MonthlyBars/);
  assert.match(ui,/function Seasonality/);
  assert.match(ui,/function PairBars/);
  assert.match(ui,/ndb-cp-kpis/);
  assert.match(ui,/selectedCat/);
  assert.match(ui,/selectedCollection/);
  assert.match(ui,/selectedWeek/);
  assert.match(ui,/setSelectedWeek\(selectedWeek===w\.week\?null:w\.week\)/);
  assert.match(ui,/category_months/);
  assert.match(ui,/collection_months/);
  assert.match(ui,/weekly_collections/);
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


test('investigação completa mostra melhor/pior semana e os períodos das coleções',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const css=read('src/commerce-categories-panel.css');
  assert.match(ui,/Melhor semana \(mês\)/);
  assert.match(ui,/Menor semana \(mês\)/);
  assert.match(ui,/collectionRows\.map\(col=>\{/);
  assert.match(ui,/Melhor mês','Melhor semana/);
  assert.match(ui,/id="ndb-cp-products"/);
  assert.match(ui,/Ver produtos/);
  assert.match(css,/\.ndb-cp-view-products/);
});


test('coleções são exibidas no card e podem abrir variações reais com SKU, imagem, unidades e link',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const css=read('src/commerce-categories-panel.css');
  const sql=read('supabase/migrations/20261030205000_commerce_categories_collections_timeline_v2.sql');
  for(const name of ['Coleção líder','Coleção em crescimento','Coleção em queda','Coleções de','Variações da coleção','variation_name'])
    assert.ok(ui.includes(name),'Ausente: '+name);
  assert.match(ui,/namedCollections=categories\.flatMap/);
  assert.match(ui,/col\.name!=='Sem coleção'/);
  assert.match(ui,/picked\?\.cols/);
  assert.match(ui,/aria-expanded=\{expanded\}/);
  assert.match(ui,/className="ndb-cp-variation-list"/);
  assert.match(ui,/colSpan=\{8\}/);
  assert.match(ui,/t\?\.variation_count/);
  assert.match(ui,/rows\(t\?\.products\)\.map\(v=>/);
  assert.match(css,/\.ndb-cp-variation-item/);
  assert.match(sql,/commerce_sku_col_v1\(k\.sku,public\.commerce_sku_name_v1\(k\.sku\)\)/);
  assert.match(sql,/'collection_months'/);
  assert.match(sql,/'weekly_collections'/);
  assert.match(sql,/'leader_collection'/);
  assert.match(sql,/'collections'/);
  assert.match(sql,/limit \(case when p_sub is null then 8 else 30 end\)/);
  assert.match(sql,/variation_name/);
  assert.match(sql,/language sql stable security invoker/);
  assert.match(sql,/revoke all on function public\.commerce_categories_timeline_v1[\s\S]*from public,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.commerce_categories_timeline_v1[\s\S]*to service_role/);
  assert.doesNotMatch(sql,/\b(delete from|truncate table|insert into|update public\.)\b/i);
});

test('categorias: série mensal corta o mês atual do ano anterior no mesmo dia', () => {
  const sql=read('supabase/migrations/20261030223000_commerce_categories_same_dates_monthly_v1.sql');
  const m=sql.match(/monthly_category as \([\s\S]*?\), monthly_col as \([\s\S]*?\), weekly_col/)[0];
  assert.equal((m.match(/p\.cut_day/g)||[]).length,2);
  assert.match(m,/yr=p\.b and mon=extract\(month from p\.as_of\)/);
});
