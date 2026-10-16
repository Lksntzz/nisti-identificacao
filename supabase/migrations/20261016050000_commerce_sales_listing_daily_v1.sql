-- Verified daily gross product sales by real marketplace listing ID.
-- No buyers, addresses, CPF, tracking numbers, or order-level personal information stored.
create table if not exists public.commerce_sales_listing_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,
  external_listing_id text not null,
  sku_norm text not null,
  units integer not null check(units>=0),
  orders_with_item integer not null check(orders_with_item>=0),
  product_revenue numeric(14,2) not null check(product_revenue>=0),
  primary key(batch_id,sale_date,external_listing_id,sku_norm)
);
create index if not exists commerce_sales_listing_daily_lookup
  on public.commerce_sales_listing_daily_v1(sale_date,external_listing_id,sku_norm);
alter table public.commerce_sales_listing_daily_v1 enable row level security;
revoke all on public.commerce_sales_listing_daily_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_sales_listing_daily_v1 to service_role;

create or replace function public.commerce_append_sales_listing_daily_v1(
  p_batch_id bigint,
  p_rows jsonb
) returns integer language plpgsql security invoker set search_path=public
as $function$
declare batch_platform text; batch_status text; affected integer;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100
    then raise exception 'seller_sales_rows_invalid' using errcode='22023';
  end if;
  select platform_code,status into batch_platform,batch_status
  from public.commerce_sales_import_batches where id=p_batch_id for update;
  if batch_platform is null or batch_platform not in ('ML_ANTIGO','ML_NOVO')
    or batch_status not in ('UPLOADED','STAGED')
    then raise exception 'seller_sales_batch_invalid' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where
    nullif(btrim(coalesce(x->>'external_listing_id','')),'') is null
    or nullif(btrim(coalesce(x->>'sku_norm','')),'') is null
    or coalesce(x->>'sale_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(x->>'units','') !~ '^[0-9]+$'
    or coalesce(x->>'orders_with_item','') !~ '^[0-9]+$'
    or coalesce(x->>'product_revenue','') !~ '^[0-9]+(\.[0-9]{1,2})?$'
  ) then raise exception 'seller_sales_row_invalid' using errcode='22023';
  end if;

  insert into public.commerce_sales_listing_daily_v1 (
    batch_id,sale_date,external_listing_id,sku_norm,units,orders_with_item,product_revenue
  )
  select p_batch_id,(x->>'sale_date')::date,
    btrim(x->>'external_listing_id'),
    btrim(x->>'sku_norm'),
    (x->>'units')::integer,
    (x->>'orders_with_item')::integer,
    (x->>'product_revenue')::numeric
  from jsonb_array_elements(p_rows) x
  on conflict(batch_id,sale_date,external_listing_id,sku_norm) do update set
    units=excluded.units,
    orders_with_item=excluded.orders_with_item,
    product_revenue=excluded.product_revenue;
  get diagnostics affected=row_count;
  return affected;
end
$function$;

-- Latest completed import owns the authoritative per-platform/per-day item facts.
-- A reimport of a corrected report replaces, never adds to, older sales for the same day.
create or replace view public.commerce_current_sales_listing_daily_v1
with (security_invoker=true)
as
with latest as (
  select distinct on (b.platform_code,s.period_start)
    b.id batch_id,b.platform_code,s.period_start sale_date
  from public.commerce_sales_import_batches b
  join public.commerce_sales_import_stage_summary s
    on s.batch_id=b.id and s.period_start=s.period_end
  where b.status='COMMITTED'
  order by b.platform_code,s.period_start,b.committed_at desc,b.id desc
)
select l.platform_code,d.sale_date,d.external_listing_id,d.sku_norm,
  d.units,d.orders_with_item,d.product_revenue
from latest l
join public.commerce_sales_listing_daily_v1 d
  on d.batch_id=l.batch_id and d.sale_date=l.sale_date;

revoke all on public.commerce_current_sales_listing_daily_v1 from public,anon,authenticated;
grant select on public.commerce_current_sales_listing_daily_v1 to service_role;

create or replace function public.commerce_sales_listing_performance_v1(
  p_platform text default 'TODAS',
  p_start date default null,
  p_end date default null,
  p_sku_norm text default null
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
select coalesce(jsonb_agg(jsonb_build_object(
  'external_listing_id',a.external_listing_id,
  'sku_norm',a.sku_norm,
  'units',a.units,
  'orders_with_item',a.orders_with_item,
  'product_revenue',a.product_revenue
) order by a.units desc,a.external_listing_id),'[]'::jsonb)
from (
  select external_listing_id,sku_norm,sum(units)::bigint units,
    sum(orders_with_item)::bigint orders_with_item,
    round(sum(product_revenue),2) product_revenue
  from public.commerce_current_sales_listing_daily_v1 x
  where (p_platform='TODAS' or x.platform_code=p_platform)
    and (p_start is null or x.sale_date>=p_start)
    and (p_end is null or x.sale_date<=p_end)
    and (p_sku_norm is null or x.sku_norm=p_sku_norm)
  group by external_listing_id,sku_norm
) a
$function$;
revoke all on function public.commerce_append_sales_listing_daily_v1(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.commerce_sales_listing_performance_v1(text,date,date,text) from public,anon,authenticated;
grant execute on function public.commerce_append_sales_listing_daily_v1(bigint,jsonb) to service_role;
grant execute on function public.commerce_sales_listing_performance_v1(text,date,date,text) to service_role;
