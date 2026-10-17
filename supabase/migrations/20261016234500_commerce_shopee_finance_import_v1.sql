-- The official Shopee order XLSX has order-level fees repeated on product rows.
-- Staging is keyed to the sales batch; only COMMITTED matching-month batches are exposed.
-- No buyer data, order IDs, raw XLSX rows, or Scanner product data is stored.
create table if not exists public.commerce_shopee_finance_month_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  month_start date not null,
  orders integer not null check (orders>=0),
  units integer not null check (units>=0),
  product_revenue numeric(18,2) not null,
  seller_discount numeric(18,2) not null,
  commission_net numeric(18,2) not null,
  service_net numeric(18,2) not null,
  transaction_fee numeric(18,2) not null,
  fee_orders integer not null check (fee_orders>=0),
  single_sku_fee_orders integer not null check (single_sku_fee_orders>=0),
  unallocated_orders integer not null check (unallocated_orders>=0),
  unallocated_units integer not null check (unallocated_units>=0),
  unallocated_revenue numeric(18,2) not null,
  primary key (batch_id,month_start),
  constraint shopee_finance_month_day_one check(month_start=date_trunc('month',month_start)::date),
  constraint shopee_finance_month_orders_check check(fee_orders<=orders and single_sku_fee_orders<=fee_orders and unallocated_orders<=orders)
);
create table if not exists public.commerce_shopee_finance_sku_daily_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,
  sku_norm text not null check(length(sku_norm) between 1 and 160),
  orders integer not null check(orders>=0),
  units integer not null check(units>=0),
  product_revenue numeric(18,2) not null,
  seller_discount numeric(18,2) not null,
  commission_net numeric(18,2) not null,
  service_net numeric(18,2) not null,
  transaction_fee numeric(18,2) not null,
  primary key(batch_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_sku_daily_date_idx
  on public.commerce_shopee_finance_sku_daily_v1(sale_date,sku_norm);
alter table public.commerce_shopee_finance_month_v1 enable row level security;
alter table public.commerce_shopee_finance_sku_daily_v1 enable row level security;
revoke all on public.commerce_shopee_finance_month_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_sku_daily_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_month_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_sku_daily_v1 to service_role;

create or replace function public.commerce_append_shopee_finance_v1(
  p_batch_id bigint,p_kind text,p_rows jsonb
) returns integer
language plpgsql security invoker set search_path=public as $fn$
declare v_status text;v_platform text;v_count integer;
begin
  if p_kind not in ('MONTH','SKU_DAILY') or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Dados financeiros Shopee inválidos.';
  end if;
  select status,platform_code into v_status,v_platform
  from public.commerce_sales_import_batches where id=p_batch_id for update;
  if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
    then raise exception 'Lote Shopee não está aberto para dados financeiros.';end if;
  if exists(select 1 from jsonb_array_elements(p_rows) e where
    (p_kind='MONTH' and (e->>'month_start') !~ '^20[0-9]{2}-[0-9]{2}-01$') or
    (p_kind='SKU_DAILY' and ((e->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or length(public.commerce_nisti_sku_norm_v1(e->>'sku_norm')) not between 1 and 160))
    or (e->>'orders') !~ '^[0-9]{1,8}$'
    or (e->>'units') !~ '^[0-9]{1,8}$'
    or (e->>'product_revenue') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
    or (e->>'seller_discount') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
    or (e->>'commission_net') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
    or (e->>'service_net') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
    or (e->>'transaction_fee') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
    or (p_kind='MONTH' and ((e->>'fee_orders') !~ '^[0-9]{1,8}$'
      or (e->>'single_sku_fee_orders') !~ '^[0-9]{1,8}$'
      or (e->>'unallocated_orders') !~ '^[0-9]{1,8}$'
      or (e->>'unallocated_units') !~ '^[0-9]{1,8}$'
      or (e->>'unallocated_revenue') !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'))
  ) then raise exception 'Valores financeiros Shopee inválidos ou ausentes.';end if;
  if p_kind='MONTH' then
    insert into public.commerce_shopee_finance_month_v1(
      batch_id,month_start,orders,units,product_revenue,seller_discount,
      commission_net,service_net,transaction_fee,fee_orders,
      single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
    select p_batch_id,(e->>'month_start')::date,(e->>'orders')::int,
      (e->>'units')::int,(e->>'product_revenue')::numeric,(e->>'seller_discount')::numeric,
      (e->>'commission_net')::numeric,(e->>'service_net')::numeric,
      (e->>'transaction_fee')::numeric,(e->>'fee_orders')::int,
      (e->>'single_sku_fee_orders')::int,(e->>'unallocated_orders')::int,
      (e->>'unallocated_units')::int,(e->>'unallocated_revenue')::numeric
    from jsonb_array_elements(p_rows) e
    on conflict(batch_id,month_start) do update set
      orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
      seller_discount=excluded.seller_discount,commission_net=excluded.commission_net,
      service_net=excluded.service_net,transaction_fee=excluded.transaction_fee,
      fee_orders=excluded.fee_orders,
      single_sku_fee_orders=excluded.single_sku_fee_orders,
      unallocated_orders=excluded.unallocated_orders,
      unallocated_units=excluded.unallocated_units,
      unallocated_revenue=excluded.unallocated_revenue;
  else
    insert into public.commerce_shopee_finance_sku_daily_v1(
      batch_id,sale_date,sku_norm,orders,units,product_revenue,seller_discount,
      commission_net,service_net,transaction_fee)
    select p_batch_id,(e->>'sale_date')::date,
      public.commerce_nisti_sku_norm_v1(e->>'sku_norm'),(e->>'orders')::int,
      (e->>'units')::int,(e->>'product_revenue')::numeric,(e->>'seller_discount')::numeric,
      (e->>'commission_net')::numeric,(e->>'service_net')::numeric,
      (e->>'transaction_fee')::numeric
    from jsonb_array_elements(p_rows) e
    on conflict(batch_id,sale_date,sku_norm) do update set
      orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
      seller_discount=excluded.seller_discount,commission_net=excluded.commission_net,
      service_net=excluded.service_net,transaction_fee=excluded.transaction_fee;
  end if;
  get diagnostics v_count=row_count;
  return v_count;
end $fn$;
revoke all on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb) to service_role;

-- Latest valid committed sales batch for each imported month, whether or not
-- it contained financial data. Thus a newer nonfinancial import never silently
-- inherits stale fees from an older report.
create or replace view public.commerce_shopee_finance_current_months_v1
with (security_invoker=true) as
with imported as (
 select distinct on (date_trunc('month',s.period_start)::date)
   date_trunc('month',s.period_start)::date month_start,
   b.snapshot_id
 from public.commerce_sales_import_batches b
 join public.commerce_sales_import_stage_rows s on s.batch_id=b.id
 where b.platform_code='SHOPEE' and b.status='COMMITTED' and b.snapshot_id is not null
 order by date_trunc('month',s.period_start)::date,b.committed_at desc nulls last,b.id desc
)
select i.month_start,i.snapshot_id,
       sum(f.orders)::bigint orders,sum(f.units)::bigint units,
       sum(f.product_revenue)::numeric product_revenue,
       sum(f.seller_discount)::numeric seller_discount,
       sum(f.commission_net)::numeric commission_net,
       sum(f.service_net)::numeric service_net,
       sum(f.transaction_fee)::numeric transaction_fee,
       sum(f.fee_orders)::bigint fee_orders,
       sum(f.single_sku_fee_orders)::bigint single_sku_fee_orders,
       sum(f.unallocated_orders)::bigint unallocated_orders,
       sum(f.unallocated_units)::bigint unallocated_units
from imported i
left join public.commerce_sales_import_batches b on b.snapshot_id=i.snapshot_id
left join public.commerce_shopee_finance_month_v1 f
 on f.batch_id=b.id and f.month_start=i.month_start
group by i.month_start,i.snapshot_id;
revoke all on public.commerce_shopee_finance_current_months_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_current_months_v1 to service_role;

create or replace function public.commerce_shopee_month_coverage_finance_v1(p_month text)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as(
 select to_date(p_month||'-01','YYYY-MM-DD') m
 where p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
), original as (
 select coalesce(sum(r.units),0)::bigint units,
 coalesce(round(sum(r.product_revenue),2),0)::numeric revenue
 from public.commerce_sales_rows r
 join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
 cross join input i where r.platform_code='SHOPEE' and r.period_start=i.m
), mapped as (
 select coalesce(sum(r.units),0)::bigint units,
 coalesce(round(sum(r.product_revenue),2),0)::numeric revenue
 from public.commerce_sales_rows r
 join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
 cross join input i
 join public.commerce_shopee_sku_owner_reviewed_v1 o
 on o.source_sku_norm=public.commerce_nisti_sku_norm_v1(r.sku_norm)
 where r.platform_code='SHOPEE' and r.period_start=i.m
), financial as (
 select f.* from public.commerce_shopee_finance_current_months_v1 f
 join input i on i.m=f.month_start
)
select jsonb_build_object(
 'period',p_month,
 'imported_units',(select units from original),
 'mapped_units',(select units from mapped),
 'unmapped_units',greatest(0,(select units from original)-(select units from mapped)),
 'coverage_pct',case when (select units from original)>0
 then round(100.0*(select units from mapped)/(select units from original),2) else null end,
 'finance_available',exists(select 1 from financial where fee_orders is not null),
 'fee_orders',(select fee_orders from financial),
 'orders',(select orders from financial),
 'seller_discount',(select seller_discount from financial),
 'commission_net',(select commission_net from financial),
 'service_net',(select service_net from financial),
 'transaction_fee',(select transaction_fee from financial),
 'unallocated_orders',(select unallocated_orders from financial),
 'single_sku_fee_orders',(select single_sku_fee_orders from financial)
);
$fn$;
revoke all on function public.commerce_shopee_month_coverage_finance_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_shopee_month_coverage_finance_v1(text) to service_role;
