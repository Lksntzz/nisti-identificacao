-- Cobertura de vendas por plataforma e ano (para avisar quando um ano ainda não foi importado).
create or replace function public.commerce_annual_compare_coverage_v1()
returns jsonb language sql stable set search_path to 'public' as $f$
select coalesce(jsonb_agg(jsonb_build_object('platform',plat,'year',yr,'units',u,'days',d) order by plat, yr),'[]'::jsonb)
from (
  select plat, extract(year from sale_date)::int yr, sum(units)::bigint u, count(distinct sale_date)::int d
  from (
    select 'SHOPEE'::text plat, sale_date, units from public.commerce_shopee_sales_sku_daily_v1
    union all
    select platform_code, sale_date, units from public.commerce_current_sales_listing_daily_v1 where platform_code like 'ML%'
  ) s group by 1,2
) t;
$f$;
revoke all on function public.commerce_annual_compare_coverage_v1() from public,anon,authenticated;
grant execute on function public.commerce_annual_compare_coverage_v1() to service_role;
