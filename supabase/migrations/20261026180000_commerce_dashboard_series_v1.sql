-- Somente leitura. Faturamento e unidades por dia (atual por plataforma + dia equivalente do periodo anterior).
create or replace function public.commerce_dashboard_series_v1(
  p_platform text default 'TODAS', p_days integer default 30
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_days in (7,30,60,90) then p_days else 30 end days
), base as (
  select v.sale_date,v.platform_code,v.units,v.product_revenue from public.commerce_current_sales_listing_daily_v1 v, params p
  where p.plat='TODAS' or v.platform_code=p.plat
), ref as (select max(sale_date) last_day from base),
days as (
  select g.i,(r.last_day-p.days+1+g.i) cur_day,(r.last_day-p.days+1+g.i-p.days) prev_day
  from ref r cross join params p cross join lateral generate_series(0,p.days-1) g(i)
), agg as (
  select d.i,d.cur_day,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code='SHOPEE'),0) cur_shopee,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code<>'SHOPEE'),0) cur_ml,
    coalesce(sum(b.units) filter (where b.sale_date=d.cur_day),0) cur_units,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.prev_day),0) prev_rev,
    coalesce(sum(b.units) filter (where b.sale_date=d.prev_day),0) prev_units
  from days d left join base b on b.sale_date in (d.cur_day,d.prev_day) group by d.i,d.cur_day
)
select jsonb_build_object('platform',(select plat from params),'days',(select days from params),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('day',cur_day,'shopee',round(cur_shopee,2),'ml',round(cur_ml,2),
    'units',cur_units,'prev_revenue',round(prev_rev,2),'prev_units',prev_units) order by i) from agg),'[]'::jsonb));
$function$;
revoke all on function public.commerce_dashboard_series_v1(text,integer) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_series_v1(text,integer) to service_role;
