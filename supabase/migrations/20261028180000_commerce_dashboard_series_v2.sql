-- Vendas por dia por plataforma (Shopee, ML Antigo, ML Novo separados), para os ultimos N dias ou para um mes civil,
-- com o dia equivalente do periodo anterior por plataforma. Somente leitura. Ignora o dia corrente (incompleto).
create or replace function public.commerce_dashboard_series_v2(
  p_platform text default 'TODAS', p_days integer default 30, p_month text default null
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_days in (7,30,60,90) then p_days else 30 end days,
         case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then (p_month||'-01')::date end ms
), base as (
  select v.* from public.commerce_current_sales_listing_daily_v1 v, params p
  where (p.plat='TODAS' or v.platform_code=p.plat)
    and v.sale_date < (now() at time zone 'America/Sao_Paulo')::date
), ref as (select max(sale_date) last_day from base),
days as (
  select case when p.ms is not null then (p.ms+g.i)::date else (r.last_day-p.days+1+g.i) end cur_day,
         case when p.ms is not null then (p.ms+g.i-interval '1 month')::date else (r.last_day-p.days+1+g.i-p.days) end prev_day,
         g.i
  from params p cross join ref r
  cross join lateral generate_series(0,case when p.ms is not null then (p.ms+interval '1 month')::date-p.ms-1 else p.days-1 end) g(i)
  where p.ms is null or (p.ms+g.i)<=r.last_day
), agg as (
  select d.i,d.cur_day,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code='SHOPEE'),0) r_sh,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code='ML_ANTIGO'),0) r_ma,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code='ML_NOVO'),0) r_mn,
    coalesce(sum(b.units) filter (where b.sale_date=d.cur_day and b.platform_code='SHOPEE'),0) u_sh,
    coalesce(sum(b.units) filter (where b.sale_date=d.cur_day and b.platform_code='ML_ANTIGO'),0) u_ma,
    coalesce(sum(b.units) filter (where b.sale_date=d.cur_day and b.platform_code='ML_NOVO'),0) u_mn,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.prev_day and b.platform_code='SHOPEE'),0) pr_sh,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.prev_day and b.platform_code='ML_ANTIGO'),0) pr_ma,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.prev_day and b.platform_code='ML_NOVO'),0) pr_mn,
    coalesce(sum(b.units) filter (where b.sale_date=d.prev_day and b.platform_code='SHOPEE'),0) pu_sh,
    coalesce(sum(b.units) filter (where b.sale_date=d.prev_day and b.platform_code='ML_ANTIGO'),0) pu_ma,
    coalesce(sum(b.units) filter (where b.sale_date=d.prev_day and b.platform_code='ML_NOVO'),0) pu_mn
  from days d left join base b on b.sale_date in (d.cur_day,d.prev_day) group by d.i,d.cur_day
)
select jsonb_build_object('platform',(select plat from params),'month',p_month,'days',(select count(*) from days),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('day',cur_day,
    'shopee',round(r_sh,2),'ml_antigo',round(r_ma,2),'ml_novo',round(r_mn,2),'ml',round(r_ma+r_mn,2),
    'units_shopee',u_sh,'units_ml_antigo',u_ma,'units_ml_novo',u_mn,'units',u_sh+u_ma+u_mn,
    'prev_shopee',round(pr_sh,2),'prev_ml_antigo',round(pr_ma,2),'prev_ml_novo',round(pr_mn,2),'prev_revenue',round(pr_sh+pr_ma+pr_mn,2),
    'prev_units_shopee',pu_sh,'prev_units_ml_antigo',pu_ma,'prev_units_ml_novo',pu_mn,'prev_units',pu_sh+pu_ma+pu_mn) order by i) from agg),'[]'::jsonb));
$function$;
revoke all on function public.commerce_dashboard_series_v2(text,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_series_v2(text,integer,text) to service_role;
