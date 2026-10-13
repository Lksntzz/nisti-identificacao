begin;

create or replace function public.commerce_product_sales_planning_v1(
  p_product_ids bigint[],
  p_platform text default 'TODAS',
  p_months integer default 3
) returns jsonb
language sql stable security invoker set search_path = ''
as $$
with
params as (
  select
    (now() at time zone 'America/Sao_Paulo')::date as today_local,
    date_trunc('month',now() at time zone 'America/Sao_Paulo')::date as current_month,
    greatest(1,least(12,coalesce(p_months,3))) as history_months,
    case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_NOVO','ML_ANTIGO','MERCADO_LIVRE')
      then upper(p_platform) else 'TODAS' end as platform
),
ids as (select distinct unnest(coalesce(p_product_ids,array[]::bigint[])) as product_id),
snapshot as (
  select s.id from public.commerce_sales_snapshots s
  where s.is_current=true order by s.id desc limit 1
),
sku_map as (
  select distinct ps.product_id,public.commerce_nisti_sku_norm_v1(ps.sku) as sku_norm
  from public.commerce_product_skus ps join ids on ids.product_id=ps.product_id
  where ps.is_active is distinct from false and nullif(btrim(ps.sku),'') is not null
),
available as (
  select date_trunc('month',sr.period_start)::date as month,
    min(sr.period_start)::date as first_date,
    least(max(sr.period_end)::date,(select today_local from params)) as last_date
  from public.commerce_sales_summary_rows sr
  join snapshot sn on sn.id=sr.snapshot_id cross join params p
  where (p.platform='TODAS' or sr.platform_code=p.platform or (p.platform='MERCADO_LIVRE' and sr.platform_code in ('ML_NOVO','ML_ANTIGO')))
    and sr.period_start>=p.current_month-(p.history_months || ' months')::interval
    and sr.period_start<p.current_month+interval '1 month'
  group by 1
),
units_by_month as (
  select sm.product_id,date_trunc('month',r.period_start)::date as month,
    sum(r.units)::bigint as units
  from public.commerce_sales_rows r join snapshot sn on sn.id=r.snapshot_id
  join sku_map sm on sm.sku_norm=r.sku_norm
  cross join params p
  where (p.platform='TODAS' or r.platform_code=p.platform or (p.platform='MERCADO_LIVRE' and r.platform_code in ('ML_NOVO','ML_ANTIGO')))
    and r.period_start>=p.current_month-(p.history_months || ' months')::interval
    and r.period_start<p.current_month+interval '1 month'
  group by sm.product_id,2
),
monthly as (
  select ids.product_id,a.month,a.first_date,a.last_date,coalesce(u.units,0)::bigint as units
  from ids cross join available a
  left join units_by_month u on u.product_id=ids.product_id and u.month=a.month
),
per_product as (
  select ids.product_id,
    max(m.units) filter(where m.month=p.current_month) as month_units,
    max(m.first_date) filter(where m.month=p.current_month) as month_first_date,
    max(m.last_date) filter(where m.month=p.current_month) as month_last_date,
    round(avg(m.units) filter(where m.month<p.current_month),1) as historic_monthly_average,
    count(m.month) filter(where m.month<p.current_month) as historic_months_imported,
    coalesce(jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),
      'units',m.units,'recorded_until',m.last_date)
      order by m.month) filter(where m.month is not null),'[]'::jsonb) as history
  from ids cross join params p left join monthly m on m.product_id=ids.product_id
  group by ids.product_id
)
select jsonb_build_object(
  'period',to_char((select current_month from params),'YYYY-MM'),
  'platform',(select platform from params),
  'items',coalesce(jsonb_agg(jsonb_build_object(
    'product_id',q.product_id,
    'month_units',q.month_units,
    'recorded_until',q.month_last_date,
    'historic_monthly_average',q.historic_monthly_average,
    'historic_months_imported',q.historic_months_imported,
    'daily_average',case when q.month_units is not null and q.month_last_date>=q.month_first_date then
      round(q.month_units::numeric/greatest(1,q.month_last_date-q.month_first_date+1),2) end,
    'month_projection',case when q.month_units is not null and q.month_last_date>=q.month_first_date then
      round(q.month_units::numeric/greatest(1,q.month_last_date-q.month_first_date+1) *
      extract(day from (date_trunc('month',q.month_first_date::timestamp)+interval '1 month'-interval '1 day')))::integer end,
    'history',q.history
  ) order by q.product_id),'[]'::jsonb)
)
from per_product q;
$$;

revoke all on function public.commerce_product_sales_planning_v1(bigint[],text,integer) from public,anon,authenticated;
grant execute on function public.commerce_product_sales_planning_v1(bigint[],text,integer) to service_role;

commit;
