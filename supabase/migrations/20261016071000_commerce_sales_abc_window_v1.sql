-- Curva ABC calculated over the SAME daily window and covered seller accounts as product performance.
create or replace function public.commerce_sales_abc_window_v1(
  p_platform text default 'TODAS',p_days integer default 30,
  p_reference_month text default null,p_basis text default 'REVENUE'
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with inputs as (
  select upper(coalesce(nullif(trim(p_basis),''),'REVENUE')) basis,
    public.commerce_sales_velocity_v2(p_days,p_platform,p_reference_month,'ALL',1,0) performance
), window_settings as (
  select (performance->>'current_start')::date start_date,
    (performance->>'current_end')::date end_date,
    performance->'covered_sources' sources,
    (performance->>'current_ready')::boolean ready
  from inputs
), filtered as (
  select public.commerce_nisti_sku_norm_v1(d.sku_norm) sku_norm,
    d.sale_date,d.units,d.product_revenue,d.orders_with_item
  from public.commerce_current_sales_listing_daily_v1 d
  cross join window_settings w
  where w.ready and d.sale_date between w.start_date and w.end_date
    and d.platform_code in (select value from jsonb_array_elements_text(w.sources))
), by_sku as (
  select sku_norm,sum(units)::bigint units,round(sum(product_revenue),2) revenue
  from filtered where nullif(sku_norm,'') is not null group by sku_norm
), eligible as (
  select b.*,case when (select basis from inputs)='UNITS'
    then b.units::numeric else b.revenue end score
  from by_sku b
), ranked as (
  select e.*,sum(score) over() grand_total,
    coalesce(sum(score) over(order by score desc,sku_norm rows between unbounded preceding and 1 preceding),0) prior
  from eligible e where e.score>0
), classified as (
  select r.*,case when prior<grand_total*0.8 then 'A'
    when prior<grand_total*0.95 then 'B' else 'C' end class
  from ranked r
), classes(code) as (values('A'),('B'),('C')), aggregated as (
  select c.code,count(r.sku_norm)::bigint products,
    coalesce(sum(r.units),0)::bigint units,
    coalesce(round(sum(r.revenue),2),0)::numeric revenue,
    coalesce(sum(r.score),0)::numeric score
  from classes c left join classified r on r.class=c.code group by c.code
), history as (
  select to_char(date_trunc('month',sale_date),'YYYY-MM') period_key,
    sum(units)::bigint units,round(sum(product_revenue),2) revenue
  from filtered group by date_trunc('month',sale_date)
)
select jsonb_build_object(
  'has_snapshot',(select (performance->>'has_snapshot')::boolean from inputs),
  'has_sales',exists(select 1 from ranked),
  'basis',(select basis from inputs),
  'data_through',(select performance->>'data_through' from inputs),
  'period_start',(select start_date from window_settings),
  'period_end',(select end_date from window_settings),
  'covered_sources',(select sources from window_settings),
  'current_ready',(select ready from window_settings),
  'net_orders',(select coalesce(sum(orders_with_item),0) from filtered),
  'periods',coalesce((select jsonb_agg(distinct to_char(date_trunc('month',sale_date),'YYYY-MM'))
    from public.commerce_current_sales_listing_daily_v1),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(jsonb_build_object(
    'period_key',h.period_key,'units',h.units,'product_revenue',h.revenue
  ) order by h.period_key) from history h),'[]'::jsonb),
  'sku_count',(select count(*) from by_sku),
  'total_revenue',(select coalesce(sum(revenue),0) from by_sku),
  'total_units',(select coalesce(sum(units),0) from by_sku),
  'classes',coalesce((select jsonb_agg(jsonb_build_object(
    'class',a.code,'products',a.products,'units',a.units,'revenue',a.revenue,
    'percentage',case when (select sum(score) from ranked)>0
      then round(a.score*100/(select sum(score) from ranked),2) else 0 end
  ) order by case a.code when 'A' then 1 when 'B' then 2 else 3 end)
    from aggregated a),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'sku_norm',r.sku_norm,'class',r.class,'units',r.units,'revenue',r.revenue
  ) order by r.score desc,r.sku_norm) from classified r),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_abc_window_v1(text,integer,text,text)
  from public,anon,authenticated;
grant execute on function public.commerce_sales_abc_window_v1(text,integer,text,text)
  to service_role;
