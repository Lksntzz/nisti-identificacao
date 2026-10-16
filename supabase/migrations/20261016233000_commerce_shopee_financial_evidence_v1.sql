-- Shopee financial evidence from official sales exports. Financial fields are
-- order-level: never duplicate them for each variation row. This schema is
-- isolated from Scanner, product catalog, and existing sales snapshots.
create table if not exists public.commerce_shopee_finance_month_v1(
 month_start date primary key,
 data_through date not null,
 source text not null,
 source_fingerprint text not null,
 orders integer not null check(orders>=0),
 units integer not null check(units>=0),
 product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 fee_orders integer not null check(fee_orders>=0),
 single_sku_fee_orders integer not null check(single_sku_fee_orders>=0),
 unallocated_orders integer not null check(unallocated_orders>=0),
 unallocated_units integer not null check(unallocated_units>=0),
 unallocated_revenue numeric(18,2) not null,
 updated_at timestamptz not null default now(),
 check (fee_orders<=orders and single_sku_fee_orders<=fee_orders),
 check (data_through>=month_start and data_through<(month_start+interval '1 month')::date)
);
create table if not exists public.commerce_shopee_finance_daily_v1(
 month_start date not null references public.commerce_shopee_finance_month_v1(month_start) on delete cascade,
 sale_date date not null,
 sku_norm text not null,
 orders integer not null check(orders>0),
 units integer not null check(units>0),
 product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 primary key(month_start,sale_date,sku_norm),
 check(sale_date>=month_start and sale_date<(month_start+interval '1 month')::date)
);
create index if not exists commerce_shopee_finance_daily_sku_date_idx
 on public.commerce_shopee_finance_daily_v1(sku_norm,sale_date);

create table if not exists public.commerce_shopee_finance_stage_month_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id),
 month_start date not null,
 data_through date not null,
 orders integer not null,
 units integer not null,
 product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 fee_orders integer not null,
 single_sku_fee_orders integer not null,
 unallocated_orders integer not null,
 unallocated_units integer not null,
 unallocated_revenue numeric(18,2) not null,
 primary key(batch_id,month_start)
);
create table if not exists public.commerce_shopee_finance_stage_daily_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id),
 sale_date date not null,
 sku_norm text not null,
 orders integer not null,
 units integer not null,
 product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 primary key(batch_id,sale_date,sku_norm)
);
do $$
declare t text;
begin
 foreach t in array array[
 'commerce_shopee_finance_month_v1','commerce_shopee_finance_daily_v1',
 'commerce_shopee_finance_stage_month_v1','commerce_shopee_finance_stage_daily_v1']
 loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $$;

create or replace function public.commerce_shopee_finance_stage_v1(
 p_batch_id bigint,p_kind text,p_rows jsonb
) returns integer language plpgsql volatile security invoker set search_path=public as $fn$
declare v_count integer;v_status text;v_platform text;
begin
 if p_kind not in ('MONTH','DAILY') or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_rows) not between 1 and 100
 then raise exception 'Lote financeiro inválido.';end if;
 select status,platform_code into v_status,v_platform
 from public.commerce_sales_import_batches where id=p_batch_id for update;
 if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
 then raise exception 'Importação Shopee financeira não está aberta.';end if;
 if p_kind='MONTH' then
  insert into public.commerce_shopee_finance_stage_month_v1(
   batch_id,month_start,data_through,orders,units,product_revenue,
   seller_discount,transaction_fee,commission_net,service_net,fee_orders,
   single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
  select p_batch_id,(r->>'month_start')::date,
   to_date(coalesce(r->>'data_through',r->>'month_start'),'YYYY-MM-DD'),
   (r->>'orders')::integer,(r->>'units')::integer,(r->>'product_revenue')::numeric,
   (r->>'seller_discount')::numeric,(r->>'transaction_fee')::numeric,
   (r->>'commission_net')::numeric,(r->>'service_net')::numeric,
   (r->>'fee_orders')::integer,(r->>'single_sku_fee_orders')::integer,
   (r->>'unallocated_orders')::integer,(r->>'unallocated_units')::integer,
   (r->>'unallocated_revenue')::numeric from jsonb_array_elements(p_rows) r
  on conflict(batch_id,month_start) do update set
   data_through=excluded.data_through,orders=excluded.orders,units=excluded.units,
   product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
   transaction_fee=excluded.transaction_fee,commission_net=excluded.commission_net,
   service_net=excluded.service_net,fee_orders=excluded.fee_orders,
   single_sku_fee_orders=excluded.single_sku_fee_orders,
   unallocated_orders=excluded.unallocated_orders,unallocated_units=excluded.unallocated_units,
   unallocated_revenue=excluded.unallocated_revenue;
 else
  insert into public.commerce_shopee_finance_stage_daily_v1(
   batch_id,sale_date,sku_norm,orders,units,product_revenue,seller_discount,
   transaction_fee,commission_net,service_net)
  select p_batch_id,(r->>'sale_date')::date,
   public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),
   (r->>'orders')::integer,(r->>'units')::integer,(r->>'product_revenue')::numeric,
   (r->>'seller_discount')::numeric,(r->>'transaction_fee')::numeric,
   (r->>'commission_net')::numeric,(r->>'service_net')::numeric
  from jsonb_array_elements(p_rows) r
  on conflict(batch_id,sale_date,sku_norm) do update set
   orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
   seller_discount=excluded.seller_discount,transaction_fee=excluded.transaction_fee,
   commission_net=excluded.commission_net,service_net=excluded.service_net;
 end if;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;

-- Activate financial figures only after the sales snapshot has committed.
-- Months must reconcile to the SAME current Shopee sales summary; otherwise
-- outdated/partial financial figures remain unavailable instead of fabricated.
create or replace function public.commerce_shopee_finance_activate_v1(
 p_batch_id bigint
) returns jsonb language plpgsql volatile security invoker set search_path=public as $fn$
declare v_snap bigint;v_month record;v_count int:=0;v_daily int:=0;
begin
 select b.snapshot_id into v_snap from public.commerce_sales_import_batches b
 where b.id=p_batch_id and b.platform_code='SHOPEE' and b.status='COMMITTED';
 if v_snap is null or not exists(select 1 from public.commerce_sales_snapshots where id=v_snap and is_current)
 then raise exception 'Importação não foi confirmada no snapshot atual.';end if;
 perform pg_advisory_xact_lock(2026,1608);
 for v_month in
  select m.month_start,max(m.data_through) data_through,
   sum(m.orders)::int orders,sum(m.units)::int units,
   round(sum(m.product_revenue),2) product_revenue,
   round(sum(m.seller_discount),2) seller_discount,
   round(sum(m.transaction_fee),2) transaction_fee,
   round(sum(m.commission_net),2) commission_net,
   round(sum(m.service_net),2) service_net,
   sum(m.fee_orders)::int fee_orders,
   sum(m.single_sku_fee_orders)::int single_sku_fee_orders,
   sum(m.unallocated_orders)::int unallocated_orders,
   sum(m.unallocated_units)::int unallocated_units,
   round(sum(m.unallocated_revenue),2) unallocated_revenue
  from public.commerce_shopee_finance_stage_month_v1 m
  join public.commerce_sales_import_batches b on b.id=m.batch_id
  where b.snapshot_id=v_snap and b.status='COMMITTED' and b.platform_code='SHOPEE'
  group by m.month_start
 loop
  if not exists(
   select 1 from public.commerce_sales_summary_rows s
   where s.snapshot_id=v_snap and s.platform_code='SHOPEE'
    and s.period_start=v_month.month_start
    and s.units=v_month.units
    and abs(s.product_revenue-v_month.product_revenue)<0.02
  ) then raise exception 'Totais financeiros diferentes das vendas atuais de %',v_month.month_start;end if;
  insert into public.commerce_shopee_finance_month_v1(
   month_start,data_through,source,source_fingerprint,orders,units,product_revenue,
   seller_discount,transaction_fee,commission_net,service_net,
   fee_orders,single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
  values(v_month.month_start,v_month.data_through,'IMPORTADO_NISTI',v_snap::text,
   v_month.orders,v_month.units,v_month.product_revenue,v_month.seller_discount,
   v_month.transaction_fee,v_month.commission_net,v_month.service_net,
   v_month.fee_orders,v_month.single_sku_fee_orders,
   v_month.unallocated_orders,v_month.unallocated_units,v_month.unallocated_revenue)
  on conflict(month_start) do update set
   data_through=excluded.data_through,source=excluded.source,
   source_fingerprint=excluded.source_fingerprint,orders=excluded.orders,units=excluded.units,
   product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
   transaction_fee=excluded.transaction_fee,commission_net=excluded.commission_net,
   service_net=excluded.service_net,fee_orders=excluded.fee_orders,
   single_sku_fee_orders=excluded.single_sku_fee_orders,
   unallocated_orders=excluded.unallocated_orders,unallocated_units=excluded.unallocated_units,
   unallocated_revenue=excluded.unallocated_revenue,updated_at=now();
  delete from public.commerce_shopee_finance_daily_v1 where month_start=v_month.month_start;
  insert into public.commerce_shopee_finance_daily_v1(
   month_start,sale_date,sku_norm,orders,units,product_revenue,
   seller_discount,transaction_fee,commission_net,service_net)
  select v_month.month_start,d.sale_date,d.sku_norm,
   sum(d.orders)::int,sum(d.units)::int,round(sum(d.product_revenue),2),
   round(sum(d.seller_discount),2),round(sum(d.transaction_fee),2),
   round(sum(d.commission_net),2),round(sum(d.service_net),2)
  from public.commerce_shopee_finance_stage_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id
  where b.snapshot_id=v_snap and b.status='COMMITTED'
   and b.platform_code='SHOPEE'
   and date_trunc('month',d.sale_date)::date=v_month.month_start
  group by d.sale_date,d.sku_norm;
  get diagnostics v_daily=row_count;
  v_count:=v_count+1;
 end loop;
 return jsonb_build_object('months',v_count,'source_snapshot',v_snap);
end $fn$;

-- Current financial validity is independent of the year-wide snapshot id:
-- subsequent imports must not invalidate unchanged, previously verified months.
create or replace view public.commerce_shopee_finance_verified_month_v1
with (security_invoker=true) as
select m.*
from public.commerce_shopee_finance_month_v1 m
join public.commerce_sales_snapshots sn on sn.is_current
join public.commerce_sales_summary_rows s
 on s.snapshot_id=sn.id and s.platform_code='SHOPEE'
 and s.period_start=m.month_start and s.units=m.units
 and abs(s.product_revenue-m.product_revenue)<0.02;

-- The order export has no listing ID. Financial amounts are only attributed
-- to a listing through a unique reviewed SKU owner; multi-SKU orders are NOT
-- arbitrarily divided. No final payout / net profit assertion is made.
create or replace function public.commerce_shopee_finance_listing_v1(
 p_listing_id bigint,p_start date,p_end date
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as (
 select p_listing_id listing_id,p_start date_start,p_end date_end
 where p_start is not null and p_end>=p_start and p_end-p_start<=366
), active_listing as (
 select l.id from public.commerce_listings l join public.commerce_marketplaces m
 on m.id=l.marketplace_id and m.code='SHOPEE'
 join input i on i.listing_id=l.id
), safe_owners as (
 select o.source_sku_norm,min(o.listing_id) listing_id
 from public.commerce_shopee_sku_owner_reviewed_v1 o
 group by o.source_sku_norm having count(distinct o.listing_id)=1
), eligible as (
 select d.* from public.commerce_shopee_finance_daily_v1 d
 join public.commerce_shopee_finance_verified_month_v1 m on m.month_start=d.month_start
 join safe_owners o on o.source_sku_norm=d.sku_norm
 join active_listing l on l.id=o.listing_id
 join input i on d.sale_date between i.date_start and i.date_end
), totals as (
 select coalesce(sum(orders),0)::bigint attributed_orders,
 coalesce(sum(units),0)::bigint attributed_units,
 coalesce(round(sum(product_revenue),2),0)::numeric attributed_subtotal,
 coalesce(round(sum(seller_discount),2),0)::numeric seller_discount,
 coalesce(round(sum(transaction_fee),2),0)::numeric transaction_fee,
 coalesce(round(sum(commission_net),2),0)::numeric commission_net,
 coalesce(round(sum(service_net),2),0)::numeric service_net
 from eligible
), months as (
 select count(*)::int financial_months
 from public.commerce_shopee_finance_verified_month_v1 m join input i
 on m.month_start<=i.date_end and m.data_through>=i.date_start
)
select jsonb_build_object(
 'available', (select attributed_orders>0 from totals),
 'financial_months',(select financial_months from months),
 'attributed_orders',attributed_orders,'attributed_units',attributed_units,
 'attributed_subtotal',attributed_subtotal,'seller_discount',seller_discount,
 'transaction_fee',transaction_fee,'commission_net',commission_net,
 'service_net',service_net,
 'after_identified_fees',round(attributed_subtotal-transaction_fee-commission_net-service_net,2),
 'partial',true,'seller_discount_already_in_subtotal',true,
 'not_payout',true
) from totals
$fn$;

do $$
declare p text;
begin
 foreach p in array array[
 'commerce_shopee_finance_stage_v1(bigint,text,jsonb)',
 'commerce_shopee_finance_activate_v1(bigint)',
 'commerce_shopee_finance_listing_v1(bigint,date,date)']
 loop
  execute format('revoke all on function public.%s from public,anon,authenticated',p);
  execute format('grant execute on function public.%s to service_role',p);
 end loop;
end $$;
revoke all on public.commerce_shopee_finance_verified_month_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_verified_month_v1 to service_role;
