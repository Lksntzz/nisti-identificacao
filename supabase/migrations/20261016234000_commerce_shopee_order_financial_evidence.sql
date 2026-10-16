-- Financial source evidence for Shopee. The seller export repeats order-level
-- platform fees per SKU line. Store one order-level fee aggregate per month and
-- only attach fees to individual SKU days when the paid order has ONE distinct SKU.
-- This never mutates sales snapshots, Scanner products or historical SKUs.
create table if not exists public.commerce_shopee_finance_month_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  month_start date not null,
  orders integer not null check(orders>=0),
  units integer not null check(units>=0),
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
  primary key(batch_id,month_start),
  constraint finance_month_coverage_check check(
    fee_orders between 0 and orders
    and single_sku_fee_orders between 0 and fee_orders
    and unallocated_orders between 0 and orders
    and unallocated_units between 0 and units)
);
create table if not exists public.commerce_shopee_finance_sku_daily_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,sku_norm text not null,
  orders integer not null check(orders>0),
  units integer not null check(units>0),
  product_revenue numeric(18,2) not null,
  seller_discount numeric(18,2) not null,
  transaction_fee numeric(18,2) not null,
  commission_net numeric(18,2) not null,
  service_net numeric(18,2) not null,
  primary key(batch_id,sale_date,sku_norm),
  constraint finance_sku_normalized check(sku_norm=public.commerce_nisti_sku_norm_v1(sku_norm)
    and length(sku_norm) between 1 and 160)
);
create index if not exists commerce_shopee_finance_daily_date_idx
 on public.commerce_shopee_finance_sku_daily_v1(sale_date,sku_norm);

alter table public.commerce_shopee_finance_month_v1 enable row level security;
alter table public.commerce_shopee_finance_sku_daily_v1 enable row level security;
revoke all on public.commerce_shopee_finance_month_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_sku_daily_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_month_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_sku_daily_v1 to service_role;

create or replace function public.commerce_append_shopee_finance_v1(
 p_batch_id bigint,p_kind text,p_rows jsonb
) returns integer language plpgsql security invoker
 set search_path=public as $fn$
declare v_count int;v_platform text;v_status text;
begin
 if upper(coalesce(p_kind,'')) not in ('MONTH','DAILY')
   or jsonb_typeof(p_rows) is distinct from 'array'
   or jsonb_array_length(p_rows) not between 1 and 100 then
   raise exception 'Dados financeiros Shopee devem ter 1 a 100 registros.';
 end if;
 select platform_code,status into v_platform,v_status
 from public.commerce_sales_import_batches where id=p_batch_id for update;
 if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
   then raise exception 'Lote Shopee inválido ou já encerrado.';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) x where
   (upper(p_kind)='MONTH' and (x->>'month_start') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$')
   or (upper(p_kind)='DAILY' and ((x->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
     or nullif(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),'') is null))
   or not exists(select 1 from jsonb_each_text(x) f where f.key='units')
   or exists(select 1 from jsonb_each_text(x) f
       where f.key in ('orders','units','fee_orders','single_sku_fee_orders',
         'unallocated_orders','unallocated_units')
       and f.value !~ '^[0-9]{1,9}$')
   or exists(select 1 from jsonb_each_text(x) f
       where f.key in ('product_revenue','seller_discount','transaction_fee',
         'commission_net','service_net','unallocated_revenue')
       and f.value !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$')
 ) then raise exception 'Valores financeiros inválidos.';end if;
 if upper(p_kind)='MONTH' then
   insert into public.commerce_shopee_finance_month_v1(
     batch_id,month_start,orders,units,product_revenue,seller_discount,
     transaction_fee,commission_net,service_net,fee_orders,
     single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
   select p_batch_id,(x->>'month_start')::date,(x->>'orders')::int,
    (x->>'units')::int,(x->>'product_revenue')::numeric,
    (x->>'seller_discount')::numeric,(x->>'transaction_fee')::numeric,
    (x->>'commission_net')::numeric,(x->>'service_net')::numeric,
    (x->>'fee_orders')::int,(x->>'single_sku_fee_orders')::int,
    (x->>'unallocated_orders')::int,(x->>'unallocated_units')::int,
    (x->>'unallocated_revenue')::numeric
   from jsonb_array_elements(p_rows) x
   on conflict(batch_id,month_start) do update set
    orders=excluded.orders,units=excluded.units,
    product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
    transaction_fee=excluded.transaction_fee,commission_net=excluded.commission_net,
    service_net=excluded.service_net,fee_orders=excluded.fee_orders,
    single_sku_fee_orders=excluded.single_sku_fee_orders,
    unallocated_orders=excluded.unallocated_orders,
    unallocated_units=excluded.unallocated_units,
    unallocated_revenue=excluded.unallocated_revenue;
 else
   insert into public.commerce_shopee_finance_sku_daily_v1(
    batch_id,sale_date,sku_norm,orders,units,product_revenue,seller_discount,
    transaction_fee,commission_net,service_net)
   select p_batch_id,(x->>'sale_date')::date,public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),
     (x->>'orders')::int,(x->>'units')::int,(x->>'product_revenue')::numeric,
     (x->>'seller_discount')::numeric,(x->>'transaction_fee')::numeric,
     (x->>'commission_net')::numeric,(x->>'service_net')::numeric
   from jsonb_array_elements(p_rows) x
   on conflict(batch_id,sale_date,sku_norm) do update set
    orders=excluded.orders,units=excluded.units,
    product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
    transaction_fee=excluded.transaction_fee,commission_net=excluded.commission_net,
    service_net=excluded.service_net;
 end if;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;
revoke all on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb) to service_role;

-- All parts of a multipart import receive the same snapshot_id on commit.
-- A later complete import of one month supersedes ALL earlier batch evidence.
-- If the new batch has no financial rows, old fees are NOT reused.
create or replace view public.commerce_shopee_finance_latest_batches_v1
with(security_invoker=true) as
with covered as (
 select distinct b.id,b.snapshot_id,date_trunc('month',r.period_start)::date month_start
 from public.commerce_sales_import_batches b
 join public.commerce_sales_import_stage_rows r on r.batch_id=b.id
 where b.platform_code='SHOPEE' and b.status='COMMITTED' and b.snapshot_id is not null
), newest as (
 select month_start,max(snapshot_id) snapshot_id from covered group by 1
)
select c.* from covered c join newest n using(month_start,snapshot_id)
where exists(select 1 from public.commerce_sales_summary_rows s
 join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current
 where s.platform_code='SHOPEE' and s.period_start=c.month_start);
revoke all on public.commerce_shopee_finance_latest_batches_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_latest_batches_v1 to service_role;

create or replace view public.commerce_shopee_finance_current_month_v1
with(security_invoker=true) as
select m.month_start,
 sum(m.orders)::bigint orders,
 sum(m.units)::bigint units,
 round(sum(m.product_revenue),2) product_revenue,
 round(sum(m.seller_discount),2) seller_discount,
 round(sum(m.transaction_fee),2) transaction_fee,
 round(sum(m.commission_net),2) commission_net,
 round(sum(m.service_net),2) service_net,
 sum(m.fee_orders)::bigint fee_orders,
 sum(m.single_sku_fee_orders)::bigint single_sku_fee_orders,
 sum(m.unallocated_orders)::bigint unallocated_orders,
 sum(m.unallocated_units)::bigint unallocated_units,
 round(sum(m.unallocated_revenue),2) unallocated_revenue
from public.commerce_shopee_finance_month_v1 m
join public.commerce_shopee_finance_latest_batches_v1 b
 on b.id=m.batch_id and b.month_start=m.month_start
group by m.month_start;
revoke all on public.commerce_shopee_finance_current_month_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_current_month_v1 to service_role;

create or replace view public.commerce_shopee_finance_current_sku_day_v1
with(security_invoker=true) as
select d.sale_date,d.sku_norm,
 sum(d.orders)::bigint orders,sum(d.units)::bigint units,
 round(sum(d.product_revenue),2) product_revenue,
 round(sum(d.seller_discount),2) seller_discount,
 round(sum(d.transaction_fee),2) transaction_fee,
 round(sum(d.commission_net),2) commission_net,
 round(sum(d.service_net),2) service_net
from public.commerce_shopee_finance_sku_daily_v1 d
join public.commerce_shopee_finance_latest_batches_v1 b
 on b.id=d.batch_id and b.month_start=date_trunc('month',d.sale_date)::date
group by d.sale_date,d.sku_norm;
revoke all on public.commerce_shopee_finance_current_sku_day_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_current_sku_day_v1 to service_role;

-- Information shown in the listing's Finance tab. Total order fees are
-- attributed only for single-SKU paid orders with unique reviewed owners.
-- The resulting subtotal is NOT seller payout (freight/coupons/settlement
-- adjustments are excluded); seller discounts are not deducted again.
create or replace function public.commerce_shopee_listing_finance_v1(
 p_listing_id bigint,p_days integer default 30,p_month text default null
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with selected_listing as (
 select l.id from public.commerce_listings l join public.commerce_marketplaces m on m.id=l.marketplace_id
 where l.id=p_listing_id and l.listing_status='ACTIVE' and m.code='SHOPEE'
), limits as (
 select case when nullif(p_month,'') is not null then to_date(p_month||'-01','YYYY-MM-DD')::date
  else (select max(sale_date) from public.commerce_shopee_sales_sku_daily_v1) -
    (case when p_days in (7,30,60,90) then p_days else 30 end)+1 end start_day,
 case when nullif(p_month,'') is not null then
  (to_date(p_month||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date
  else (select max(sale_date) from public.commerce_shopee_sales_sku_daily_v1) end end_day
), matched as (
 select d.* from public.commerce_shopee_finance_current_sku_day_v1 d
 join public.commerce_shopee_sku_owner_reviewed_v1 o on o.source_sku_norm=d.sku_norm
 join selected_listing l on l.id=o.listing_id
 cross join limits p where d.sale_date between p.start_day and p.end_day
), source_month as(
 select sum(m.fee_orders)::bigint fee_orders,sum(m.orders)::bigint source_orders
 from public.commerce_shopee_finance_current_month_v1 m cross join limits p
 where m.month_start between date_trunc('month',p.start_day)::date and date_trunc('month',p.end_day)::date
)
select jsonb_build_object(
 'listing_id',p_listing_id,
 'period_start',(select start_day from limits),
 'period_end',(select end_day from limits),
 'has_financial',exists(select 1 from matched),
 'source_has_financial',coalesce((select fee_orders from source_month),0)>0,
 'matched_orders',coalesce((select sum(orders) from matched),0),
 'matched_units',coalesce((select sum(units) from matched),0),
 'product_revenue',coalesce((select round(sum(product_revenue),2) from matched),0),
 'seller_discount',coalesce((select round(sum(seller_discount),2) from matched),0),
 'transaction_fee',coalesce((select round(sum(transaction_fee),2) from matched),0),
 'commission_net',coalesce((select round(sum(commission_net),2) from matched),0),
 'service_net',coalesce((select round(sum(service_net),2) from matched),0),
 'subtotal_minus_identified_fees',
 coalesce((select round(sum(product_revenue-transaction_fee-commission_net-service_net),2)
   from matched),0),
 'scope','SINGLE_SKU_ORDERS_ONLY',
 'is_payout',false);
$fn$;
revoke all on function public.commerce_shopee_listing_finance_v1(bigint,integer,text)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_listing_finance_v1(bigint,integer,text) to service_role;

create or replace function public.commerce_shopee_month_coverage_v1(p_month text)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with period as(select to_date(p_month||'-01','YYYY-MM-DD')::date first_day
 where p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
incoming as (
 select sum(s.units)::bigint total_units,round(sum(s.product_revenue),2) total_revenue
 from public.commerce_sales_rows s
 join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current
 join period p on p.first_day=s.period_start
 where s.platform_code='SHOPEE'
), linked as (
 select sum(s.units)::bigint units,round(sum(s.product_revenue),2) revenue
 from public.commerce_sales_rows s
 join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current
 join period p on p.first_day=s.period_start
 where s.platform_code='SHOPEE' and exists(
   select 1 from public.commerce_shopee_sku_owner_reviewed_v1 o
   where o.source_sku_norm=public.commerce_nisti_sku_norm_v1(s.sku_norm))
),fin as(select f.* from public.commerce_shopee_finance_current_month_v1 f
 join period p on p.first_day=f.month_start)
select jsonb_build_object(
 'month',(select first_day from period),
 'total_units',coalesce((select total_units from incoming),0),
 'linked_units',coalesce((select units from linked),0),
 'unlinked_units',greatest(0,coalesce((select total_units from incoming),0)-coalesce((select units from linked),0)),
 'linked_pct',case when coalesce((select total_units from incoming),0)>0 then
  round(100.0*coalesce((select units from linked),0)/(select total_units from incoming),2) else null end,
 'finance_available',exists(select 1 from fin),
 'finance_orders',coalesce((select orders from fin),0),
 'finance_fee_orders',coalesce((select fee_orders from fin),0),
 'finance_attributable_orders',coalesce((select single_sku_fee_orders from fin),0),
 'finance_seller_discount',(select seller_discount from fin),
 'finance_commission',(select commission_net from fin),
 'finance_service_fee',(select service_net from fin),
 'finance_transaction_fee',(select transaction_fee from fin),
 'finance_unallocated_orders',coalesce((select unallocated_orders from fin),0),
 'finance_unallocated_units',coalesce((select unallocated_units from fin),0));
$fn$;
revoke all on function public.commerce_shopee_month_coverage_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_shopee_month_coverage_v1(text) to service_role;
