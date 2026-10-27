-- Vendas por mês e por plataforma (somente dias fechados). Somente leitura, apenas service_role.
create or replace function public.commerce_dashboard_monthly_v1(p_platform text default 'TODAS')
returns jsonb
language sql
stable
set search_path to 'public'
as $f$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat
), base as (
  select v.* from public.commerce_current_sales_listing_daily_v1 v, params p
  where (p.plat='TODAS' or v.platform_code=p.plat)
    and v.sale_date < (now() at time zone 'America/Sao_Paulo')::date
), m as (
  select date_trunc('month',sale_date)::date mth,
    coalesce(sum(product_revenue) filter (where platform_code='SHOPEE'),0) shopee,
    coalesce(sum(product_revenue) filter (where platform_code='ML_ANTIGO'),0) ml_antigo,
    coalesce(sum(product_revenue) filter (where platform_code='ML_NOVO'),0) ml_novo,
    coalesce(sum(units) filter (where platform_code='SHOPEE'),0) units_shopee,
    coalesce(sum(units) filter (where platform_code='ML_ANTIGO'),0) units_ml_antigo,
    coalesce(sum(units) filter (where platform_code='ML_NOVO'),0) units_ml_novo,
    count(distinct sale_date) days_with_sales,min(sale_date) first_day,max(sale_date) last_day
  from base group by 1
)
select jsonb_build_object(
  'platform',(select plat from params),
  'first_day',(select min(sale_date) from base),'last_day',(select max(sale_date) from base),
  'months',coalesce((select jsonb_agg(jsonb_build_object('month',mth,'shopee',round(shopee,2),'ml_antigo',round(ml_antigo,2),'ml_novo',round(ml_novo,2),
      'units_shopee',units_shopee,'units_ml_antigo',units_ml_antigo,'units_ml_novo',units_ml_novo,
      'days_with_sales',days_with_sales,'first_day',first_day,'last_day',last_day) order by mth) from m),'[]'::jsonb));
$f$;
revoke all on function public.commerce_dashboard_monthly_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_monthly_v1(text) to service_role;
