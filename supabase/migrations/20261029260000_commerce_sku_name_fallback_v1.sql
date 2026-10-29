-- SKU vendido sem cadastro de produto: usa o nome do próprio relatório de vendas importado (o de maior volume).
create index if not exists commerce_sales_rows_sku_canon_idx on public.commerce_sales_rows ((upper(regexp_replace(coalesce(sku_norm,sku),'[\s_]+','','g'))));

create or replace function public.commerce_sku_name_v1(p_sku text) returns text language sql stable set search_path to 'public' as $f$
  select coalesce(
    (select pp.name from public.commerce_product_skus ps join public.commerce_products pp on pp.id=ps.product_id
       where upper(regexp_replace(ps.sku,'[\s_]+','','g'))=p_sku limit 1),
    (select r.product_name from public.commerce_sales_rows r
       where upper(regexp_replace(coalesce(r.sku_norm,r.sku),'[\s_]+','','g'))=p_sku and r.product_name is not null
       order by r.units desc, r.snapshot_id desc limit 1));
$f$;
revoke all on function public.commerce_sku_name_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_sku_name_v1(text) to service_role;

-- Troca a busca de nome nas consultas anuais/categorias (patch via pg_get_functiondef + regexp_replace).
do $do$
declare r record; def text; nd text; n int := 0;
begin
  for r in select p.oid, p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
    'commerce_annual_month_v1','commerce_annual_period_products_v1','commerce_annual_day_products_v1','commerce_annual_compare_v1',
    'commerce_categories_v2','commerce_categories_col_v2','commerce_categories_sub_v2') loop
    def := pg_get_functiondef(r.oid);
    nd := regexp_replace(def, '\(select pp\.name from public\.commerce_product_skus ps join public\.commerce_products pp on pp\.id=ps\.product_id\s+where upper\(regexp_replace\(ps\.sku,''\[\\s_\]\+'','''',''g''\)\)=(\w+\.sku|\w+) limit 1\)', 'public.commerce_sku_name_v1(\1)', 'g');
    if nd <> def then execute nd; n := n + 1; end if;
  end loop;
  raise notice 'funcoes atualizadas: %', n;
end $do$;

-- Desempenho: nas consultas de categorias o CTE de classificação (cl) e a lista de SKUs viram "materialized",
-- senão o Postgres recalcula o nome/coleção por linha de venda (18 s). Com isso volta a ~0,7 s.
do $do$
declare r record; def text;
begin
  for r in select p.oid from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('commerce_categories_v2','commerce_categories_col_v2') loop
    def := pg_get_functiondef(r.oid);
    def := replace(def, E'\ncl as (', E'\ncl as materialized (');
    def := replace(def, 'skus as (select distinct sku from src)', 'skus as materialized (select distinct sku from src)');
    execute def;
  end loop;
end $do$;
