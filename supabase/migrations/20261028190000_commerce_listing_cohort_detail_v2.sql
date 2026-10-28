-- Detalhe do produto (Cadastros por mês) com os dados de CADA anúncio separados: meses e variações por anúncio.
-- Só leitura; reaproveita a v1 e acrescenta 'months' e 'variations' dentro de cada item de 'listings'.
create or replace function public.commerce_listing_cohort_detail_v2(p_platform text, p_product_ref text)
returns jsonb
language sql
stable
set search_path to 'public'
as $f$
with params as (
  select case when upper(coalesce(p_platform,''))='ML' then 'ML' else 'SHOPEE' end plat,
         (now() at time zone 'America/Sao_Paulo')::date today, btrim(coalesce(p_product_ref,'')) ref
), items as (
  select c.external_listing_id from public.commerce_listing_creation_v1 c, params p where c.platform=p.plat and c.product_ref=p.ref
), sales as (
  select v.external_listing_id id, v.sku_norm sku, v.sale_date, v.units, v.product_revenue
  from public.commerce_current_sales_listing_daily_v1 v join items i on i.external_listing_id=v.external_listing_id, params p
  where v.sale_date < p.today
), lastday as (select max(sale_date) d from public.commerce_current_sales_listing_daily_v1, params where sale_date < params.today),
lmon as (select id, date_trunc('month',sale_date)::date mth, sum(units) u, sum(product_revenue) revenue from sales group by 1,2),
vnames as (
  select l.external_listing_id id, regexp_replace(upper(lp.platform_sku),'[^A-Z0-9]','','g') sku, min(lp.platform_sku) sku_show,
         (array_agg(nullif(btrim(lp.variation_name),'') order by lp.variation_name) filter (where nullif(btrim(lp.variation_name),'') is not null))[1] name
  from public.commerce_listing_products lp join public.commerce_listings l on l.id=lp.listing_id join items i on i.external_listing_id=l.external_listing_id
  where lp.platform_sku is not null group by 1,2
), vt as (
  select id, sku, sum(units) units, sum(product_revenue) revenue,
         coalesce(sum(units) filter (where sale_date > (select d from lastday) - 28),0) u28 from sales group by 1,2
), vm as (select id, sku, date_trunc('month',sale_date)::date mth, sum(units) u from sales group by 1,2,3),
vbest as (select distinct on (id,sku) id, sku, mth, u from vm order by id, sku, u desc, mth),
vall as (select id, sku from vnames union select id, sku from sales),
per as (
  select i.external_listing_id id,
    coalesce((select jsonb_agg(jsonb_build_object('month',m.mth,'units',m.u,'revenue',round(m.revenue,2)) order by m.mth) from lmon m where m.id=i.external_listing_id),'[]'::jsonb) months,
    coalesce((select jsonb_agg(jsonb_build_object('sku',coalesce(n.sku_show,k.sku),'name',n.name,'units',coalesce(t.units,0),'revenue',round(coalesce(t.revenue,0),2),
        'u_last28',coalesce(t.u28,0),'best_month',b.mth,'best_month_units',b.u) order by coalesce(t.units,0) desc, k.sku)
      from vall k left join vnames n on n.id=k.id and n.sku=k.sku left join vt t on t.id=k.id and t.sku=k.sku left join vbest b on b.id=k.id and b.sku=k.sku
      where k.id=i.external_listing_id),'[]'::jsonb) variations
  from items i
), base as (select public.commerce_listing_cohort_detail_v1(p_platform,p_product_ref) j)
select jsonb_set(b.j,'{listings}',coalesce((select jsonb_agg(l || jsonb_build_object('months',coalesce(p.months,'[]'::jsonb),'variations',coalesce(p.variations,'[]'::jsonb)) order by o)
  from jsonb_array_elements(b.j->'listings') with ordinality t(l,o) left join per p on p.id=l->>'external_id'),'[]'::jsonb))
from base b;
$f$;
revoke all on function public.commerce_listing_cohort_detail_v2(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohort_detail_v2(text,text) to service_role;
