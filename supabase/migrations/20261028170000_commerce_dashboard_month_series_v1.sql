-- Vendas por dia de um mes civil (grafico do Dashboard), com o dia equivalente do mes anterior. Somente leitura.
-- Ignora o dia corrente (incompleto), igual as demais consultas do dashboard.
create or replace function public.commerce_dashboard_month_series_v1(
  p_platform text default 'TODAS', p_month text default null
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then (p_month||'-01')::date end ms
), base as (
  select v.* from public.commerce_current_sales_listing_daily_v1 v, params p
  where (p.plat='TODAS' or v.platform_code=p.plat)
    and v.sale_date < (now() at time zone 'America/Sao_Paulo')::date
), ref as (select max(sale_date) last_day from base),
days as (
  select (p.ms+g.i)::date cur_day,(p.ms+g.i-interval '1 month')::date prev_day,g.i
  from params p cross join ref r cross join lateral generate_series(0,(p.ms+interval '1 month')::date-p.ms-1) g(i)
  where p.ms is not null and (p.ms+g.i)<=r.last_day
), agg as (
  select d.i,d.cur_day,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code='SHOPEE'),0) cur_shopee,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code<>'SHOPEE'),0) cur_ml,
    coalesce(sum(b.units) filter (where b.sale_date=d.cur_day),0) cur_units,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.prev_day),0) prev_rev,
    coalesce(sum(b.units) filter (where b.sale_date=d.prev_day),0) prev_units
  from days d left join base b on b.sale_date in (d.cur_day,d.prev_day) group by d.i,d.cur_day
)
select jsonb_build_object('platform',(select plat from params),'month',p_month,
  'daily',coalesce((select jsonb_agg(jsonb_build_object('day',cur_day,'shopee',round(cur_shopee,2),'ml',round(cur_ml,2),
    'units',cur_units,'prev_revenue',round(prev_rev,2),'prev_units',prev_units) order by i) from agg),'[]'::jsonb));
$function$;
revoke all on function public.commerce_dashboard_month_series_v1(text,text) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_month_series_v1(text,text) to service_role;
