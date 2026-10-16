-- Shopee order fee import: order-level fee values are deduplicated by the
-- browser before staging. We only allocate fees to a variation if the complete
-- order contained ONE unique SKU. Multi-SKU orders remain in monthly totals
-- without invented per-ad fee allocations. No buyer identifiers are persisted.
create table if not exists public.commerce_shopee_finance_stage_daily_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
 sale_date date not null,sku_norm text not null,
 orders integer not null check(orders>=0),
 units integer not null check(units>=0),
 product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 primary key(batch_id,sale_date,sku_norm)
);
create table if not exists public.commerce_shopee_finance_stage_month_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
 month_start date not null,orders integer not null,units integer not null,
 product_revenue numeric(18,2) not null,seller_discount numeric(18,2) not null,
 commission_net numeric(18,2) not null,service_net numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,fee_orders integer not null,
 single_sku_fee_orders integer not null,unallocated_orders integer not null,
 unallocated_units integer not null,unallocated_revenue numeric(18,2) not null,
 primary key(batch_id,month_start),
 check(orders>=0 and units>=0 and fee_orders>=0 and
       single_sku_fee_orders>=0 and single_sku_fee_orders<=fee_orders and
       fee_orders<=orders and unallocated_orders>=0 and
       unallocated_units>=0)
);
create table if not exists public.commerce_shopee_finance_month_v1(
 month_start date primary key,source_snapshot_id bigint not null
   references public.commerce_sales_snapshots(id),
 orders integer not null,units integer not null,product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,transaction_fee numeric(18,2) not null,
 fee_orders integer not null,single_sku_fee_orders integer not null,
 unallocated_orders integer not null,unallocated_units integer not null,
 unallocated_revenue numeric(18,2) not null,activated_at timestamptz not null default now()
);
create table if not exists public.commerce_shopee_finance_daily_v1(
 sale_date date not null,sku_norm text not null,month_start date not null
   references public.commerce_shopee_finance_month_v1(month_start) on delete cascade,
 source_snapshot_id bigint not null references public.commerce_sales_snapshots(id),
 orders integer not null,units integer not null,product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,transaction_fee numeric(18,2) not null,
 primary key(sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_daily_sku_idx
 on public.commerce_shopee_finance_daily_v1(sku_norm,sale_date);
do $rls$ declare t text;begin
 foreach t in array array['commerce_shopee_finance_stage_daily_v1',
 'commerce_shopee_finance_stage_month_v1','commerce_shopee_finance_month_v1',
 'commerce_shopee_finance_daily_v1'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
end $rls$;

create or replace function public.commerce_append_shopee_finance_daily_v1(
 p_batch_id bigint,p_rows jsonb,p_source_sha256 text default null)
returns integer language plpgsql security invoker set search_path=public as $fn$
declare v_count integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>100
 then raise exception 'finance_daily_rows deve conter 1 a 100 linhas.';end if;
 if not exists(select 1 from public.commerce_sales_import_batches b
   where b.id=p_batch_id and b.platform_code='SHOPEE'
   and (b.status in ('UPLOADED','STAGED')
     or (b.status='COMMITTED' and length(coalesce(p_source_sha256,''))=64
       and lower(b.source_sha256)=lower(p_source_sha256))))
 then raise exception 'Lote de vendas Shopee inválido ou fechado.';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r where
   (r->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
   or nullif(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),'') is null
   or length(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'))>160
   or coalesce((r->>'orders')::integer,-1)<0
   or coalesce((r->>'units')::integer,-1)<0
   or (r->>'product_revenue') is null)
 then raise exception 'Dados financeiros diários inválidos.';end if;
 insert into public.commerce_shopee_finance_stage_daily_v1
 (batch_id,sale_date,sku_norm,orders,units,product_revenue,seller_discount,
  commission_net,service_net,transaction_fee)
 select p_batch_id,(r->>'sale_date')::date,public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),
 (r->>'orders')::integer,(r->>'units')::integer,(r->>'product_revenue')::numeric,
 (r->>'seller_discount')::numeric,(r->>'commission_net')::numeric,
 (r->>'service_net')::numeric,(r->>'transaction_fee')::numeric
 from jsonb_array_elements(p_rows) r
 on conflict(batch_id,sale_date,sku_norm) do update set
 orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
 seller_discount=excluded.seller_discount,commission_net=excluded.commission_net,
 service_net=excluded.service_net,transaction_fee=excluded.transaction_fee;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;

create or replace function public.commerce_append_shopee_finance_month_v1(
 p_batch_id bigint,p_rows jsonb,p_source_sha256 text default null)
returns integer language plpgsql security invoker set search_path=public as $fn$
declare v_count integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>100
 then raise exception 'finance_month_rows deve conter 1 a 100 linhas.';end if;
 if not exists(select 1 from public.commerce_sales_import_batches b
  where b.id=p_batch_id and b.platform_code='SHOPEE'
  and (b.status in ('UPLOADED','STAGED')
    or (b.status='COMMITTED' and length(coalesce(p_source_sha256,''))=64
      and lower(b.source_sha256)=lower(p_source_sha256))))
 then raise exception 'Lote financeiro não pode receber novos dados.';end if;
 insert into public.commerce_shopee_finance_stage_month_v1(
 batch_id,month_start,orders,units,product_revenue,seller_discount,
 commission_net,service_net,transaction_fee,fee_orders,
 single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
 select p_batch_id,(r->>'month_start')::date,
 (r->>'orders')::integer,(r->>'units')::integer,(r->>'product_revenue')::numeric,
 (r->>'seller_discount')::numeric,(r->>'commission_net')::numeric,
 (r->>'service_net')::numeric,(r->>'transaction_fee')::numeric,
 (r->>'fee_orders')::integer,(r->>'single_sku_fee_orders')::integer,
 (r->>'unallocated_orders')::integer,(r->>'unallocated_units')::integer,
 (r->>'unallocated_revenue')::numeric
 from jsonb_array_elements(p_rows) r
 on conflict(batch_id,month_start) do update set
 orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
 seller_discount=excluded.seller_discount,commission_net=excluded.commission_net,
 service_net=excluded.service_net,transaction_fee=excluded.transaction_fee,
 fee_orders=excluded.fee_orders,single_sku_fee_orders=excluded.single_sku_fee_orders,
 unallocated_orders=excluded.unallocated_orders,unallocated_units=excluded.unallocated_units,
 unallocated_revenue=excluded.unallocated_revenue;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;

create or replace function public.commerce_activate_shopee_finance_v1(p_batch_id bigint)
returns jsonb language plpgsql security invoker set search_path=public as $fn$
declare v_snapshot bigint;v_batch_ids bigint[];v_months integer;v_updated integer;
begin
 select snapshot_id into v_snapshot from public.commerce_sales_import_batches
 where id=p_batch_id and platform_code='SHOPEE' and status='COMMITTED';
 if v_snapshot is null then
  return jsonb_build_object('status','WAITING_COMMIT');end if;
 perform pg_advisory_xact_lock(2026,2987);
 select array_agg(id order by id) into v_batch_ids
 from public.commerce_sales_import_batches
 where platform_code='SHOPEE' and status='COMMITTED' and snapshot_id=v_snapshot;
 select count(*) into v_months from public.commerce_shopee_finance_stage_month_v1
 where batch_id=any(v_batch_ids);
 if v_months=0 then
  return jsonb_build_object('status','FINANCE_NOT_IN_SOURCE','month_count',0);
 end if;
 -- Every submitted month must fully match the ALREADY committed sales snapshot.
 -- This also guards multipart sources against publishing just part 1.
 if exists(
  with incoming as(
   select month_start,sum(units) units,round(sum(product_revenue),2) revenue,
    sum(orders) orders from public.commerce_shopee_finance_stage_month_v1
   where batch_id=any(v_batch_ids) group by month_start
  ), current_sales as(
   select date_trunc('month',period_start)::date month_start,
    sum(units) units,round(sum(product_revenue),2) revenue,
    sum(net_orders) orders
   from public.commerce_sales_summary_rows
   where snapshot_id=v_snapshot and platform_code='SHOPEE'
   group by 1
  )
  select 1 from incoming i left join current_sales s using(month_start)
   where s.month_start is null or i.units<>s.units or
    abs(i.revenue-s.revenue)>0.01 or i.orders<>s.orders
 ) then
  raise exception 'Totais financeiros diferentes das vendas confirmadas. Revise as partes do relatório.';
 end if;
 -- A source may have a small number of orders with multiple SKU lines. Those
 -- fees remain visible only at the month level, never allocated to one SKU.
 if exists(
   with incoming as (
    select month_start,sum(units) units,sum(product_revenue) revenue,
      sum(unallocated_units) unallocated_units,
      sum(unallocated_revenue) unallocated_revenue,
      sum(single_sku_fee_orders) allocated_orders
    from public.commerce_shopee_finance_stage_month_v1
    where batch_id=any(v_batch_ids) group by month_start
   ), alloc as (
    select date_trunc('month',sale_date)::date month_start,
      sum(units) units,sum(product_revenue) revenue,sum(orders) orders
    from public.commerce_shopee_finance_stage_daily_v1
    where batch_id=any(v_batch_ids) group by 1
   )
   select 1 from incoming i left join alloc a using(month_start)
   where coalesce(a.units,0)+i.unallocated_units<>i.units
     or abs(coalesce(a.revenue,0)+i.unallocated_revenue-i.revenue)>0.01
     or coalesce(a.orders,0)<>i.allocated_orders
 ) then raise exception 'Atribuição financeira não reconcilia com os pedidos do mês.';end if;
 delete from public.commerce_shopee_finance_month_v1
 where month_start in (select distinct month_start
  from public.commerce_shopee_finance_stage_month_v1
  where batch_id=any(v_batch_ids));
 insert into public.commerce_shopee_finance_month_v1(
  month_start,source_snapshot_id,orders,units,product_revenue,seller_discount,
  commission_net,service_net,transaction_fee,fee_orders,
  single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
 select month_start,v_snapshot,sum(orders)::integer,sum(units)::integer,
  round(sum(product_revenue),2),round(sum(seller_discount),2),
  round(sum(commission_net),2),round(sum(service_net),2),round(sum(transaction_fee),2),
  sum(fee_orders)::integer,sum(single_sku_fee_orders)::integer,
  sum(unallocated_orders)::integer,sum(unallocated_units)::integer,
  round(sum(unallocated_revenue),2)
 from public.commerce_shopee_finance_stage_month_v1
 where batch_id=any(v_batch_ids) group by month_start;
 get diagnostics v_updated=row_count;
 insert into public.commerce_shopee_finance_daily_v1(
   sale_date,sku_norm,month_start,source_snapshot_id,orders,units,product_revenue,
   seller_discount,commission_net,service_net,transaction_fee)
 select sale_date,sku_norm,date_trunc('month',sale_date)::date,v_snapshot,
   sum(orders)::integer,sum(units)::integer,
   round(sum(product_revenue),2),round(sum(seller_discount),2),
   round(sum(commission_net),2),round(sum(service_net),2),round(sum(transaction_fee),2)
 from public.commerce_shopee_finance_stage_daily_v1
 where batch_id=any(v_batch_ids) group by sale_date,sku_norm
 on conflict(sale_date,sku_norm) do update set
  month_start=excluded.month_start,source_snapshot_id=excluded.source_snapshot_id,
  orders=excluded.orders,units=excluded.units,
  product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
  commission_net=excluded.commission_net,service_net=excluded.service_net,
  transaction_fee=excluded.transaction_fee;
 return jsonb_build_object('status','COMMITTED','finance_months',v_updated,
  'source_snapshot_id',v_snapshot,'scope','single_sku_orders_only');
end $fn$;

-- Only finance from the most recent sales import FOR EACH MONTH is current.
-- Later imports of other months do not invalidate earlier financial data.
create or replace view public.commerce_shopee_finance_current_month_v1
with(security_invoker=true) as
select f.* from public.commerce_shopee_finance_month_v1 f
where f.source_snapshot_id=(
  select b.snapshot_id
  from public.commerce_sales_import_batches b
  join public.commerce_sales_import_stage_rows r on r.batch_id=b.id
  where b.status='COMMITTED' and b.platform_code='SHOPEE'
    and date_trunc('month',r.period_start)::date=f.month_start
  order by b.committed_at desc nulls last,b.id desc limit 1
);

create or replace function public.commerce_shopee_listing_finance_v1(
 p_listing_id bigint,p_days integer default 30,p_month text default null)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with bounds as(
 select case when p_month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'
   then (p_month||'-01')::date
   else (select max(d.sale_date) from public.commerce_shopee_sales_sku_daily_v1 d
     join public.commerce_sales_import_batches b on b.id=d.batch_id
     where b.platform_code='SHOPEE' and b.status='COMMITTED')
      - (case when p_days in (7,30,60,90) then p_days else 30 end-1)
   end start_day,
 case when p_month~'^20[0-9]{2}-(0[1-9]|1[0-2])$'
   then ((p_month||'-01')::date+interval '1 month - 1 day')::date
   else (select max(d.sale_date) from public.commerce_shopee_sales_sku_daily_v1 d
    join public.commerce_sales_import_batches b on b.id=d.batch_id
    where b.platform_code='SHOPEE' and b.status='COMMITTED')
   end end_day
), owner as (
 select distinct source_sku_norm
 from public.commerce_shopee_sku_owner_reviewed_v1
 where listing_id=p_listing_id
), eligible as (
 select d.*
 from public.commerce_shopee_finance_daily_v1 d
 join public.commerce_shopee_finance_current_month_v1 fm
  on fm.month_start=d.month_start and fm.source_snapshot_id=d.source_snapshot_id
 join bounds b on d.sale_date between b.start_day and b.end_day
 join owner o on o.source_sku_norm=d.sku_norm
), periods as(
 select count(*)::integer available_months,sum(orders)::bigint source_orders,
  sum(fee_orders)::bigint fee_orders,sum(single_sku_fee_orders)::bigint attributable_orders,
  sum(unallocated_orders)::bigint unallocated_orders
 from public.commerce_shopee_finance_current_month_v1 m
 join bounds b on m.month_start<=b.end_day
  and (m.month_start+interval '1 month - 1 day')::date>=b.start_day
), totals as (
 select count(*)::int sku_days,coalesce(sum(orders),0)::bigint orders,
 coalesce(sum(units),0)::bigint units,
 coalesce(round(sum(product_revenue),2),0)::numeric subtotal,
 coalesce(round(sum(seller_discount),2),0)::numeric seller_discount,
 coalesce(round(sum(commission_net),2),0)::numeric commission_net,
 coalesce(round(sum(service_net),2),0)::numeric service_net,
 coalesce(round(sum(transaction_fee),2),0)::numeric transaction_fee
 from eligible
)
select jsonb_build_object(
 'listing_id',p_listing_id,'period_start',(select start_day from bounds),
 'period_end',(select end_day from bounds),
 'available_months',(select available_months from periods),
 'orders_with_verified_fees',t.orders,'units_with_verified_fees',t.units,
 'fee_reconciled_subtotal',t.subtotal,'seller_discount_already_in_subtotal',t.seller_discount,
 'commission_net',t.commission_net,'service_net',t.service_net,
 'transaction_fee',t.transaction_fee,
 'after_identified_fees',round(t.subtotal-t.commission_net-t.service_net-t.transaction_fee,2),
 'has_finance_data',t.sku_days>0,
 'is_official_payout',false,
 'scope','SINGLE_SKU_ORDERS_ONLY'
) from totals t;
$fn$;
do $access$ declare signature text;begin
 foreach signature in array array[
 'commerce_append_shopee_finance_daily_v1(bigint,jsonb,text)',
 'commerce_append_shopee_finance_month_v1(bigint,jsonb,text)',
 'commerce_activate_shopee_finance_v1(bigint)',
 'commerce_shopee_listing_finance_v1(bigint,integer,text)'
 ] loop
  execute format('revoke all on function public.%s from public,anon,authenticated',signature);
  execute format('grant execute on function public.%s to service_role',signature);
 end loop;
end $access$;
revoke all on public.commerce_shopee_finance_current_month_v1
 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_current_month_v1 to service_role;
