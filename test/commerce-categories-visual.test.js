import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(path,'utf8');

test('categorias visual segue a referência: 5 indicadores, tabelas, gráficos mensais e sazonais',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const css=read('src/commerce-categories-panel.css');
  for(const title of ['Total de unidades','Categoria líder','Coleção líder','Coleção em crescimento','Quem explica a variação','Peso dos lançamentos','Comparação por categoria','Categoria selecionada','Tabela mensal','Comparação semanal'])
    assert.ok(ui.includes(title),'Falta painel: '+title);
  assert.match(ui,/function MonthlyBars/);
  assert.match(ui,/function PairBars/);
  assert.match(ui,/ndb-cp-kpis/);
  assert.match(ui,/selectedCat/);
  assert.match(ui,/selectedCollection/);
  assert.match(ui,/selectedWeek/);
  assert.match(ui,/setSelectedWeek\(selectedWeek===w\.week\?null:w\.week\)/);
  assert.match(ui,/category_months/);
  assert.match(ui,/collection_months/);
  assert.match(ui,/weekly_collections/);
  assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:680px\)/);
});
test('somente foto real do catálogo, URLs externas seguras e sem inventar valores',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  assert.match(ui,/^const validImage=/m);
  assert.match(ui,/^const validLink=/m);
  assert.match(ui,/<img src=\{src\} loading="lazy"/);
  assert.match(ui,/rel="noopener noreferrer"/);
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
  assert.match(ui,/melhor semana de/);
  assert.match(ui,/pageOf\(collectionRows,colPage\)\.items\.map\(col=>\{/);
  assert.match(ui,/Melhor mês','Melhor semana/);
  assert.doesNotMatch(ui,/Produtos e itens do período/);
  assert.match(css,/\.ndb-cp-view-products/);
});


test('coleções são exibidas no card e podem abrir variações reais com SKU, imagem, unidades e link',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const css=read('src/commerce-categories-panel.css');
  const sql=read('supabase/migrations/20261030205000_commerce_categories_collections_timeline_v2.sql');
  for(const name of ['Coleção líder','Coleção em crescimento','Coleções de','Variações da coleção','variation_name'])
    assert.ok(ui.includes(name),'Ausente: '+name);
  assert.match(ui,/namedCollections=categories\.flatMap/);
  assert.match(ui,/col\.name!=='Sem coleção'/);
  assert.match(ui,/picked\?\.cols/);
  assert.match(ui,/aria-expanded=\{expanded&&drawerOpen\}/);
  assert.match(ui,/className="ndb-cp-variation-list"/);
  assert.match(ui,/className="ndb-cp-drawer"/);
  assert.match(ui,/t\?\.variation_count/);
  assert.match(ui,/pageOf\(varRows,varPage\)\.items\.map\(v=>/);
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

test('variações abrem no acumulado do ano (igual à linha da coleção) e a migração só acrescenta chaves',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  const sql=read('supabase/migrations/20261104190000_commerce_categories_variations_ytd_v1.sql');
  assert.match(ui,/products_ytd/);
  assert.match(ui,/Ano até hoje/);
  assert.match(sql,/'products_ytd'/);
  assert.match(sql,/'variation_count_ytd'/);
  assert.match(sql,/grant execute on function public\.commerce_categories_timeline_v1[\s\S]*to service_role/);
});

test('paginação: funções usadas pela tela existem no arquivo (evita tela em branco)',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  assert.match(ui,/^const PAGE_SIZE=/m);
  assert.match(ui,/^const pageOf=/m);
  assert.match(ui,/^function Pager\(/m);
});

test('abertura rápida: a tela usa só a cobertura anual (rota leve), sem o comparativo anual completo',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  assert.match(ui,/sales-compare\/annual-coverage/);
  assert.doesNotMatch(ui,/useAnnualCompare/);
  assert.match(read('src/commerce-admin-router.js'),/sales-compare\/annual-coverage/);
  assert.match(read('src/commerce-supabase-store.js'),/export async function commerceAnnualCoverage/);
});

test('painel lateral mostra os meses que mais venderam da categoria e da coleção',()=>{
  const ui=read('src/commerce-categories-panel.jsx');
  assert.match(ui,/^function TopMonths\(/m);
  assert.match(ui,/Categoria · meses que mais venderam/);
  assert.match(ui,/Coleção · meses que mais venderam/);
  assert.match(ui,/topMonthsOf\(collectionMonths/);
});
