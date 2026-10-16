-- Financial evidence from official Shopee exports. No order/customer IDs are stored.
-- Money from an order is recorded ONCE regardless of repeated worksheet lines.
-- Orders with multiple SKUs are held at month level, never guessed onto one ad.
create table if not exists public.commerce_shopee_finance_month_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  month_start date not null,
  orders integer not null check(orders>=0),
  units bigint not null check(units>=0),
  product_revenue numeric(16,2) not null,
  fee_orders integer not null check(fee_orders>=0),
  single_sku_fee_orders integer not null check(single_sku_fee_orders>=0),
  unallocated_orders integer not null check(unallocated_orders>=0),
  unallocated_units bigint not null check(unallocated_units>=0),
  unallocated_revenue numeric(16,2) not null,
  seller_discount numeric(16,2) not null,
  commission_net numeric(16,2) not null,
  service_net numeric(16,2) not null,
  transaction_fee numeric(16,2) not null,
  primary key(batch_id,month_start)
);
create table if not exists public.commerce_shopee_finance_sku_daily_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,
  sku_norm text not null check(length(sku_norm) between 1 and 160),
  orders integer not null check(orders>=0),
  units bigint not null check(units>=0),
  product_revenue numeric(16,2) not null,
  seller_discount numeric(16,2) not null,
  commission_net numeric(16,2) not null,
  service_net numeric(16,2) not null,
  transaction_fee numeric(16,2) not null,
  primary key(batch_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_sku_date_idx
  on public.commerce_shopee_finance_sku_daily_v1(sale_date,sku_norm);
alter table public.commerce_shopee_finance_month_v1 enable row level security;
alter table public.commerce_shopee_finance_sku_daily_v1 enable row level security;
revoke all on public.commerce_shopee_finance_month_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_sku_daily_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_month_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_sku_daily_v1 to service_role;

create or replace function public.commerce_append_shopee_finance_v1(
  p_batch_id bigint,p_kind text,p_rows jsonb
) returns integer language plpgsql security invoker set search_path=public as $$
declare v_status text;v_platform text;v_count integer;v_amount text;
begin
  if upper(coalesce(p_kind,'')) not in ('MONTH','SKU_DAILY')
    or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Tipo ou quantidade de registros financeiros inválidos.';
  end if;
  select status,platform_code into v_status,v_platform
  from public.commerce_sales_import_batches where id=p_batch_id for update;
  if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
    then raise exception 'Importação financeira requer lote Shopee aberto.';end if;
  if exists(
    select 1 from jsonb_array_elements(p_rows) r
    where (case when p_kind='MONTH' then r->>'month_start' else r->>'sale_date' end)
       !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or (p_kind='SKU_DAILY' and nullif(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),'') is null)
      or exists(select 1 from (values
        ('product_revenue',r->>'product_revenue'),
        ('seller_discount',r->>'seller_discount'),
        ('commission_net',r->>'commission_net'),
        ('service_net',r->>'service_net'),
        ('transaction_fee',r->>'transaction_fee')
      ) money(k,value) where money.value is null
        or money.value !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$')
      or (r->>'units') !~ '^[0-9]{1,9}$'
      or (r->>'orders') !~ '^[0-9]{1,9}$'
  ) then raise exception 'Valores ou datas financeiras inválidos.';end if;
  if p_kind='MONTH' then
    if exists (select 1 from jsonb_array_elements(p_rows) r
      where (r->>'fee_orders') !~ '^[0-9]{1,9}$'
        or (r->>'single_sku_fee_orders') !~ '^[0-9]{1,9}$'
        or (r->>'unallocated_orders') !~ '^[0-9]{1,9}$'
        or (r->>'unallocated_units') !~ '^[0-9]{1,9}$'
        or (r->>'unallocated_revenue') !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
        or (r->>'month_start') !~ '^[0-9]{4}-[0-9]{2}-01$')
      then raise exception 'Resumo mensal financeiro inválido.';end if;
    insert into public.commerce_shopee_finance_month_v1(
      batch_id,month_start,orders,units,product_revenue,fee_orders,single_sku_fee_orders,
      unallocated_orders,unallocated_units,unallocated_revenue,
      seller_discount,commission_net,service_net,transaction_fee)
    select p_batch_id,(r->>'month_start')::date,(r->>'orders')::int,(r->>'units')::bigint,
      (r->>'product_revenue')::numeric,(r->>'fee_orders')::int,
      (r->>'single_sku_fee_orders')::int,(r->>'unallocated_orders')::int,
      (r->>'unallocated_units')::bigint,(r->>'unallocated_revenue')::numeric,
      (r->>'seller_discount')::numeric,(r->>'commission_net')::numeric,
      (r->>'service_net')::numeric,(r->>'transaction_fee')::numeric
    from jsonb_array_elements(p_rows) r
    on conflict(batch_id,month_start) do update set
      orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
      fee_orders=excluded.fee_orders,single_sku_fee_orders=excluded.single_sku_fee_orders,
      unallocated_orders=excluded.unallocated_orders,unallocated_units=excluded.unallocated_units,
      unallocated_revenue=excluded.unallocated_revenue,seller_discount=excluded.seller_discount,
      commission_net=excluded.commission_net,service_net=excluded.service_net,
      transaction_fee=excluded.transaction_fee;
  else
    insert into public.commerce_shopee_finance_sku_daily_v1(
      batch_id,sale_date,sku_norm,orders,units,product_revenue,
      seller_discount,commission_net,service_net,transaction_fee)
    select p_batch_id,(r->>'sale_date')::date,
      public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),
      (r->>'orders')::int,(r->>'units')::bigint,(r->>'product_revenue')::numeric,
      (r->>'seller_discount')::numeric,(r->>'commission_net')::numeric,
      (r->>'service_net')::numeric,(r->>'transaction_fee')::numeric
    from jsonb_array_elements(p_rows) r
    on conflict(batch_id,sale_date,sku_norm) do update set
      orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
      seller_discount=excluded.seller_discount,commission_net=excluded.commission_net,
      service_net=excluded.service_net,transaction_fee=excluded.transaction_fee;
  end if;
  get diagnostics v_count=row_count;
  return v_count;
end $$;

-- Only read financial batches whose monthly base agrees with the CURRENT
-- authoritative snapshot. A newer import without financial data blocks older
-- financial data for the same month, preventing misleading stale fees.
create or replace view public.commerce_shopee_finance_current_month_v1
with (security_invoker=true) as
with all_imports as (
  select date_trunc('month',r.period_start)::date month_start,
    max(b.snapshot_id) as latest_snapshot
  from public.commerce_sales_import_batches b
  join public.commerce_sales_import_stage_rows r on r.batch_id=b.id
  where b.status='COMMITTED' and b.platform_code='SHOPEE'
  group by 1
), grouped as (
  select f.month_start,b.snapshot_id,
    sum(f.orders)::bigint orders,sum(f.units)::bigint units,
    round(sum(f.product_revenue),2) product_revenue,
    sum(f.fee_orders)::bigint fee_orders,
    sum(f.single_sku_fee_orders)::bigint single_sku_fee_orders,
    sum(f.unallocated_orders)::bigint unallocated_orders,
    sum(f.unallocated_units)::bigint unallocated_units,
    round(sum(f.unallocated_revenue),2) unallocated_revenue,
    round(sum(f.seller_discount),2) seller_discount,
    round(sum(f.commission_net),2) commission_net,
    round(sum(f.service_net),2) service_net,
    round(sum(f.transaction_fee),2) transaction_fee
  from public.commerce_shopee_finance_month_v1 f
  join public.commerce_sales_import_batches b on b.id=f.batch_id
    and b.status='COMMITTED' and b.platform_code='SHOPEE'
  group by 1,2
)
select g.* from grouped g
join all_imports latest on latest.month_start=g.month_start
  and latest.latest_snapshot=g.snapshot_id
join public.commerce_sales_snapshots sn on sn.is_current
join public.commerce_sales_summary_rows s on s.snapshot_id=sn.id
  and s.platform_code='SHOPEE' and s.period_start=g.month_start
  and s.units=g.units and abs(s.product_revenue-g.product_revenue)<0.011;

-- Finance detail is limited to orders with a SINGLE, uniquely matched SKU.
-- This is a valid subset, not total seller payout or total ad net revenue.
create or replace function public.commerce_shopee_listing_finance_v1(
  p_listing_id text,p_days integer default 30,p_month text default null
) returns jsonb language sql stable security invoker set search_path=public as $$
with listing as (
 select l.id,l.external_listing_id from public.commerce_listings l
 join public.commerce_marketplaces mp on mp.id=l.marketplace_id
 where mp.code='SHOPEE' and l.listing_status='ACTIVE'
   and l.external_listing_id=p_listing_id
), base as (
 select case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
   then to_date(p_month||'-01','YYYY-MM-DD') else null end selected_month,
   case when p_days in (7,30,60,90) then p_days else 30 end days
), end_day as (
 select coalesce(max(s.sale_date),max(sn.data_through),current_date) last_day
 from public.commerce_shopee_sales_sku_daily_v1 s
 left join public.commerce_sales_import_batches b on b.id=s.batch_id
 left join public.commerce_sales_snapshots sn on sn.is_current
 where b.status='COMMITTED'
), periods as (
 select coalesce(base.selected_month,end_day.last_day-base.days+1) start_day,
   case when base.selected_month is not null
     then (base.selected_month+interval '1 month - 1 day')::date
     else end_day.last_day end_day
 from base cross join end_day
), eligible as (
 select d.sale_date,d.sku_norm,d.orders,d.units,d.product_revenue,
    d.seller_discount,d.commission_net,d.service_net,d.transaction_fee,
    f.month_start
 from public.commerce_shopee_finance_sku_daily_v1 d
 join public.commerce_sales_import_batches b on b.id=d.batch_id
   and b.platform_code='SHOPEE' and b.status='COMMITTED'
 join public.commerce_shopee_finance_current_month_v1 f
   on f.month_start=date_trunc('month',d.sale_date)::date
   and f.snapshot_id=b.snapshot_id
 cross join periods p
 where d.sale_date between p.start_day and p.end_day
), unique_owner as (
 select source_sku_norm,min(listing_id) listing_id
 from public.commerce_shopee_sku_owner_reviewed_v1
 group by source_sku_norm having count(*)=1
), attributed as (
 select e.* from eligible e
 join unique_owner o on o.source_sku_norm=e.sku_norm
 join listing l on l.id=o.listing_id
), totals as (
 select coalesce(sum(orders),0)::bigint orders,
   coalesce(sum(units),0)::bigint units,
   coalesce(round(sum(product_revenue),2),0)::numeric product_revenue,
   coalesce(round(sum(seller_discount),2),0)::numeric seller_discount,
   coalesce(round(sum(commission_net),2),0)::numeric commission_net,
   coalesce(round(sum(service_net),2),0)::numeric service_net,
   coalesce(round(sum(transaction_fee),2),0)::numeric transaction_fee
 from attributed
)
select jsonb_build_object(
 'source_kind','SINGLE_SKU_ORDER_FEES','financial_orders',t.orders,
 'financial_units',t.units,'financial_product_revenue',t.product_revenue,
 'seller_discount',t.seller_discount,'commission_net',t.commission_net,
 'service_net',t.service_net,'transaction_fee',t.transaction_fee,
 'net_after_fees',round(t.product_revenue-t.commission_net-t.service_net-t.transaction_fee,2),
 'fees_available',t.orders>0,
 'coverage_note','Apenas pedidos de um SKU com correspondência exclusiva; sem ratear pedidos mistos. Subtotal já inclui descontos do vendedor.'
) from totals t;
$$;
revoke all on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb) to service_role;
revoke all on function public.commerce_shopee_listing_finance_v1(text,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_shopee_listing_finance_v1(text,integer,text) to service_role;
revoke all on public.commerce_shopee_finance_current_month_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_current_month_v1 to service_role;
