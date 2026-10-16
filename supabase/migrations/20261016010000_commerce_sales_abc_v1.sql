-- Read-only Curva ABC over confirmed imported sales. No manufactured sales per advertisement.
create or replace function public.commerce_sales_abc_v1(
  p_platform text default 'TODAS',
  p_period_start text default null,
  p_period_end text default null,
  p_basis text default 'REVENUE'
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with inputs as (
  select upper(trim(coalesce(p_platform,'TODAS'))) platform,
    upper(trim(coalesce(p_basis,'REVENUE'))) basis,
    case when p_period_start ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      then to_date(p_period_start||'-01','YYYY-MM-DD') else null end month_start,
    case when p_period_end ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      then (to_date(p_period_end||'-01','YYYY-MM-DD') + interval '1 month')::date else null end month_end_exclusive
), current_snapshot as (
  select s.id,s.data_through
  from public.commerce_sales_snapshots s
  where s.is_current=true order by s.id desc limit 1
), filtered as (
  select public.commerce_nisti_sku_norm_v1(coalesce(nullif(r.sku,''),r.sku_primary,r.sku_norm)) sku_norm,
    coalesce(r.units,0)::bigint units,
    coalesce(r.product_revenue,0)::numeric revenue
  from public.commerce_sales_rows r
  join current_snapshot cs on cs.id=r.snapshot_id
  cross join inputs i
  where (i.month_start is null or r.period_start>=i.month_start)
    and (i.month_end_exclusive is null or r.period_start<i.month_end_exclusive)
    and (
      i.platform='TODAS'
      or (i.platform='MERCADO_LIVRE' and r.platform_code in ('ML_NOVO','ML_ANTIGO'))
      or (i.platform='ML_NOVO' and r.platform_code='ML_NOVO')
      or (i.platform='ML_ANTIGO' and r.platform_code='ML_ANTIGO')
      or (i.platform='SHOPEE' and r.platform_code='SHOPEE')
    )
), summary_filtered as (
  select sr.period_start,sr.net_orders,sr.units,sr.product_revenue
  from public.commerce_sales_summary_rows sr
  join current_snapshot cs on cs.id=sr.snapshot_id
  cross join inputs i
  where (i.month_start is null or sr.period_start>=i.month_start)
    and (i.month_end_exclusive is null or sr.period_start<i.month_end_exclusive)
    and (
      i.platform='TODAS'
      or (i.platform='MERCADO_LIVRE' and sr.platform_code in ('ML_NOVO','ML_ANTIGO'))
      or sr.platform_code=i.platform
    )
), monthly as (
  select to_char(date_trunc('month',sr.period_start),'YYYY-MM') period_key,
    sum(sr.net_orders)::bigint net_orders,
    sum(sr.units)::bigint units,
    round(sum(sr.product_revenue),2) revenue
  from summary_filtered sr group by date_trunc('month',sr.period_start)
), by_sku as (
  select sku_norm, sum(units)::bigint units,round(sum(revenue),2) revenue
  from filtered
  where nullif(sku_norm,'') is not null
  group by sku_norm
), eligible as (
  select b.*,case when (select basis from inputs)='UNITS' then b.units::numeric else b.revenue end score
  from by_sku b
), ranked as (
  select *,
    sum(score) over () grand_total,
    coalesce(sum(score) over (order by score desc,sku_norm rows between unbounded preceding and 1 preceding),0) preceding_score
  from eligible
  where score>0
), classified as (
  select r.*,
    case when preceding_score < grand_total*0.80 then 'A'
      when preceding_score < grand_total*0.95 then 'B'
      else 'C' end class
  from ranked r
), classes(code,sort_order) as (values('A',1),('B',2),('C',3)), aggregates as (
  select c.code,coalesce(count(r.sku_norm),0)::bigint products,
    coalesce(sum(r.units),0)::bigint units,
    coalesce(round(sum(r.revenue),2),0)::numeric revenue,
    coalesce(sum(r.score),0)::numeric score
  from classes c left join classified r on r.class=c.code
  group by c.code,c.sort_order
  order by c.sort_order
)
select jsonb_build_object(
  'has_snapshot',exists(select 1 from current_snapshot),
  'has_sales',exists(select 1 from ranked),
  'basis',(select basis from inputs),
  'data_through',(select data_through from current_snapshot),
  'net_orders',coalesce((select sum(net_orders) from summary_filtered),0),
  'periods',coalesce((
    select jsonb_agg(period_key order by period_key) from (
      select distinct to_char(date_trunc('month',sr.period_start),'YYYY-MM') period_key
      from public.commerce_sales_summary_rows sr
      join current_snapshot cs on cs.id=sr.snapshot_id
    ) t),'[]'::jsonb),
  'history',coalesce((
    select jsonb_agg(jsonb_build_object(
      'period_key',m.period_key,'net_orders',m.net_orders,
      'units',m.units,'product_revenue',m.revenue
    ) order by m.period_key) from monthly m),'[]'::jsonb),
  'sku_count',(select count(*) from by_sku),
  'total_revenue',coalesce((select round(sum(revenue),2) from by_sku),0),
  'total_units',coalesce((select sum(units) from by_sku),0),
  'classes',coalesce((select jsonb_agg(jsonb_build_object(
    'class',a.code,'products',a.products,'units',a.units,
    'revenue',a.revenue,'percentage',
    case when (select sum(score) from eligible where score>0)>0
      then round(a.score*100/(select sum(score) from eligible where score>0),2)
      else 0 end
  ) order by case a.code when 'A' then 1 when 'B' then 2 else 3 end)
    from aggregates a),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
      'sku_norm',x.sku_norm,'class',x.class,'units',x.units,'revenue',x.revenue
    ) order by x.score desc,x.sku_norm)
    from classified x),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_abc_v1(text,text,text,text) from public,anon,authenticated;
grant execute on function public.commerce_sales_abc_v1(text,text,text,text) to service_role;
