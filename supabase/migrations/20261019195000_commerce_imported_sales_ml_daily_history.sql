-- ML daily source remains valid after the monthly snapshot is consolidated.
-- Complete imported platform totals, WITHOUT filtering by current
-- listing membership or SKU reconciliation. No buyer/order PII is stored.
-- The caller supplies the exact period shown by the advertisement manager.
create or replace function public.commerce_imported_sales_totals_v1(
  p_platform text,
  p_start date,
  p_end date,
  p_monthly boolean default false
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with params as (
  select upper(coalesce(nullif(btrim(p_platform),''),'TODAS')) requested,
    p_start first_day,p_end last_day,coalesce(p_monthly,false) monthly
), selected_sources as (
  select x.code from (values('SHOPEE'),('ML_ANTIGO'),('ML_NOVO')) x(code)
  cross join params p
  where p.requested='TODAS' or p.requested=x.code
    or (p.requested='MERCADO_LIVRE' and x.code like 'ML_%')
), imported_month as (
  select r.platform_code source,r.units::bigint units,
    r.product_revenue::numeric revenue,r.net_orders::bigint orders,
    r.period_end data_through
  from public.commerce_sales_summary_rows r
  join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
  cross join params p
  where p.monthly and r.platform_code in(select code from selected_sources)
    and r.period_start=date_trunc('month',p.first_day)::date
    and r.period_end>=p.first_day
), ml_daily_raw as (
  select b.platform_code source,s.period_start sale_day,
    s.units,s.product_revenue,s.net_orders,b.snapshot_id,b.id,
    row_number() over(partition by b.platform_code,s.period_start
      order by b.snapshot_id desc,b.id desc) rn
  from public.commerce_sales_import_batches b
  join public.commerce_sales_import_stage_summary s on s.batch_id=b.id
  -- A newer consolidated snapshot may supersede the old import snapshot,
  -- without deleting the still-valid ML daily breakdown. Select latest
  -- COMMITTED batch per source/day, and never sum overlapping batches.
  cross join params p
  where not p.monthly
    and b.status='COMMITTED' and b.platform_code like 'ML_%'
    and b.platform_code in(select code from selected_sources)
    and s.period_start=s.period_end
    and s.period_start between p.first_day and p.last_day
), ml_daily as (
  select source,sum(units)::bigint units,
    round(sum(product_revenue),2)::numeric revenue,
    sum(net_orders)::bigint orders,max(sale_day) data_through
  from ml_daily_raw where rn=1 group by source
), shopee_latest_day as (
  select d.sale_date,max(b.snapshot_id) snapshot_id
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b
    on b.id=d.batch_id and b.status='COMMITTED' and b.platform_code='SHOPEE'
  join public.commerce_sales_snapshots sn
    on sn.id=b.snapshot_id and sn.is_current
  cross join params p
  where not p.monthly and 'SHOPEE' in (select code from selected_sources)
    and d.sale_date between p.first_day and p.last_day
  group by d.sale_date
), shopee_daily as (
  select 'SHOPEE'::text source,sum(d.units)::bigint units,
    round(sum(d.product_revenue),2)::numeric revenue,
    null::bigint orders,max(d.sale_date) data_through
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b
    on b.id=d.batch_id and b.status='COMMITTED' and b.platform_code='SHOPEE'
  join shopee_latest_day v on v.sale_date=d.sale_date
    and v.snapshot_id=b.snapshot_id
  where (select not monthly from params)
), totals as (
  select source,units,revenue,orders,data_through from imported_month
  union all select source,units,revenue,orders,data_through from ml_daily
  union all select source,units,revenue,orders,data_through
  from shopee_daily where units is not null
), by_source as (
  select source,sum(units)::bigint units,
    round(sum(revenue),2)::numeric revenue,
    case when count(orders)=count(*) then sum(orders)::bigint else null::bigint end orders,
    max(data_through) data_through
  from totals group by source
)
select jsonb_build_object(
  'period_start',(select first_day from params),
  'period_end',(select last_day from params),
  'kind',case when (select monthly from params) then 'IMPORTED_MONTHLY_TOTAL'
    else 'IMPORTED_DAILY_TOTAL' end,
  'available',(select count(*)>0 from by_source),
  'units',(select sum(units) from by_source),
  'revenue',(select round(sum(revenue),2) from by_source),
  'orders',(select case when count(orders)=count(*) then sum(orders) else null end from by_source),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by s.source) from by_source s),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_imported_sales_totals_v1(text,date,date,boolean)
 from public,anon,authenticated;
grant execute on function public.commerce_imported_sales_totals_v1(text,date,date,boolean)
 to service_role;
