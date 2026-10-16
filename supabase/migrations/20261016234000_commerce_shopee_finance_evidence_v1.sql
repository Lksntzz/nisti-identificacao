-- Read-only finance evidence from official Shopee order XLSX.
-- Order-level marketplace fees are deduplicated in the client BEFORE this
-- aggregate reaches the service-role API; never send order IDs or buyer PII.
-- Per-listing fees are shown ONLY for orders containing a single SKU.
-- The seller discount is informational and ALREADY reflected in product subtotal.
create table if not exists public.commerce_shopee_finance_month_stage_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id),
 month_start date not null,
 orders integer not null check(orders>=0),
 units bigint not null check(units>=0),
 product_revenue numeric(18,2) not null check(product_revenue>=0),
 seller_discount numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 fee_orders integer not null check(fee_orders>=0),
 single_sku_fee_orders integer not null check(single_sku_fee_orders>=0),
 unallocated_orders integer not null check(unallocated_orders>=0),
 unallocated_units bigint not null check(unallocated_units>=0),
 unallocated_revenue numeric(18,2) not null check(unallocated_revenue>=0),
 primary key(batch_id,month_start),
 check(month_start=date_trunc('month',month_start)::date),
 check(fee_orders<=orders and single_sku_fee_orders<=fee_orders),
 check(unallocated_orders+single_sku_fee_orders=orders),
 check(unallocated_units<=units)
);
create table if not exists public.commerce_shopee_finance_sku_daily_stage_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id),
 sale_date date not null,
 sku_norm text not null check(length(sku_norm) between 1 and 160),
 orders integer not null check(orders>0),
 units bigint not null check(units>0),
 product_revenue numeric(18,2) not null check(product_revenue>=0),
 seller_discount numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 primary key(batch_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_month_idx
 on public.commerce_shopee_finance_month_stage_v1(month_start,batch_id);
create index if not exists commerce_shopee_finance_sku_day_idx
 on public.commerce_shopee_finance_sku_daily_stage_v1(sale_date,sku_norm);
alter table public.commerce_shopee_finance_month_stage_v1 enable row level security;
alter table public.commerce_shopee_finance_sku_daily_stage_v1 enable row level security;
revoke all on public.commerce_shopee_finance_month_stage_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_sku_daily_stage_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_month_stage_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_sku_daily_stage_v1 to service_role;

create or replace function public.commerce_append_shopee_finance_v1(
 p_batch_id bigint,p_mode text,p_rows jsonb
) returns integer language plpgsql security invoker set search_path=public as $fn$
declare v_status text;v_platform text;v_count integer;
begin
 if p_mode not in ('MONTH','SKU_DAILY')
    or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 100
 then raise exception 'Financeiro Shopee requer 1 a 100 registros válidos.';end if;
 select status,platform_code into v_status,v_platform
 from public.commerce_sales_import_batches where id=p_batch_id for update;
 if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
 then raise exception 'Só é possível importar financeiro de lote Shopee aberto.';end if;

 if p_mode='MONTH' then
  if exists(select 1 from jsonb_array_elements(p_rows) x
    where (x->>'month_start') !~ '^20[0-9]{2}-[0-9]{2}-01$'
      or (x->>'orders') !~ '^[0-9]{1,8}$'
      or (x->>'units') !~ '^[0-9]{1,9}$'
      or (x->>'fee_orders') !~ '^[0-9]{1,8}$'
      or (x->>'single_sku_fee_orders') !~ '^[0-9]{1,8}$'
      or (x->>'unallocated_orders') !~ '^[0-9]{1,8}$'
      or (x->>'unallocated_units') !~ '^[0-9]{1,9}$'
      or exists(select 1 from (values
        (x->>'product_revenue'),(x->>'seller_discount'),
        (x->>'commission_net'),(x->>'service_net'),(x->>'transaction_fee'),
        (x->>'unallocated_revenue')) a(v)
        where v is null or v !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$')
  )then raise exception 'Financeiro mensal Shopee inválido.';end if;

  insert into public.commerce_shopee_finance_month_stage_v1(
    batch_id,month_start,orders,units,product_revenue,seller_discount,
    commission_net,service_net,transaction_fee,fee_orders,
    single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
  select p_batch_id,(x->>'month_start')::date,(x->>'orders')::int,
    (x->>'units')::bigint,(x->>'product_revenue')::numeric,
    (x->>'seller_discount')::numeric,(x->>'commission_net')::numeric,
    (x->>'service_net')::numeric,(x->>'transaction_fee')::numeric,
    (x->>'fee_orders')::int,(x->>'single_sku_fee_orders')::int,
    (x->>'unallocated_orders')::int,(x->>'unallocated_units')::bigint,
    (x->>'unallocated_revenue')::numeric
  from jsonb_array_elements(p_rows) x
  on conflict(batch_id,month_start) do update set
    orders=excluded.orders,units=excluded.units,
    product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
    commission_net=excluded.commission_net,service_net=excluded.service_net,
    transaction_fee=excluded.transaction_fee,fee_orders=excluded.fee_orders,
    single_sku_fee_orders=excluded.single_sku_fee_orders,
    unallocated_orders=excluded.unallocated_orders,
    unallocated_units=excluded.unallocated_units,
    unallocated_revenue=excluded.unallocated_revenue;
 else
  if exists(select 1 from jsonb_array_elements(p_rows) x
    where (x->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or nullif(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),'') is null
      or length(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'))>160
      or (x->>'orders') !~ '^[0-9]{1,8}$'
      or (x->>'units') !~ '^[1-9][0-9]{0,8}$'
      or exists(select 1 from (values
        (x->>'product_revenue'),(x->>'seller_discount'),
        (x->>'commission_net'),(x->>'service_net'),(x->>'transaction_fee')) a(v)
        where v is null or v !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$')
  )then raise exception 'Financeiro diário Shopee inválido.';end if;

  insert into public.commerce_shopee_finance_sku_daily_stage_v1(
    batch_id,sale_date,sku_norm,orders,units,product_revenue,seller_discount,
    commission_net,service_net,transaction_fee)
  select p_batch_id,(x->>'sale_date')::date,
    public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),
    (x->>'orders')::int,(x->>'units')::bigint,(x->>'product_revenue')::numeric,
    (x->>'seller_discount')::numeric,(x->>'commission_net')::numeric,
    (x->>'service_net')::numeric,(x->>'transaction_fee')::numeric
  from jsonb_array_elements(p_rows) x
  on conflict(batch_id,sale_date,sku_norm) do update set
    orders=excluded.orders,units=excluded.units,
    product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
    commission_net=excluded.commission_net,service_net=excluded.service_net,
    transaction_fee=excluded.transaction_fee;
 end if;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;
revoke all on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb)
 to service_role;

-- Return ONLY values from finance imports that reconcile exactly to the
-- current commercial snapshot for their whole MONTH (including split exports).
-- All time-window queries explicitly show partial finance-month coverage.
create or replace function public.commerce_shopee_finance_report_v1(
 p_listing_id bigint,p_month text default null,p_days integer default 30
)returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as(
 select case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
   then to_date(p_month||'-01','YYYY-MM-DD') else null end chosen_month,
 case when p_days in (7,30,60,90) then p_days else 30 end days
),latest as(
 select max(period_end) end_date from public.commerce_sales_summary_rows s
 join public.commerce_sales_snapshots snap on snap.id=s.snapshot_id and snap.is_current
 where s.platform_code='SHOPEE'
),bounds as(
 select case when i.chosen_month is not null then i.chosen_month
   else l.end_date-(i.days-1) end period_start,
 case when i.chosen_month is not null then
   (i.chosen_month+interval '1 month - 1 day')::date else l.end_date end period_end
 from input i cross join latest l
),snapshot_months as(
 select s.period_start month_start,s.units,s.product_revenue,s.net_orders
 from public.commerce_sales_summary_rows s
 join public.commerce_sales_snapshots snap on snap.id=s.snapshot_id and snap.is_current
 cross join bounds b
 where s.platform_code='SHOPEE'
   and s.period_start between date_trunc('month',b.period_start)::date
    and date_trunc('month',b.period_end)::date
),groups as(
 select m.month_start,b.snapshot_id,
   sum(m.units) units,sum(m.product_revenue) product_revenue,
   sum(m.orders) orders,sum(m.fee_orders) fee_orders,
   sum(m.single_sku_fee_orders) single_sku_fee_orders,
   sum(m.unallocated_orders) unallocated_orders,
   sum(m.seller_discount) seller_discount,
   sum(m.commission_net) commission_net,sum(m.service_net) service_net,
   sum(m.transaction_fee) transaction_fee
 from public.commerce_shopee_finance_month_stage_v1 m
 join public.commerce_sales_import_batches b on b.id=m.batch_id and b.status='COMMITTED'
 group by m.month_start,b.snapshot_id
),validated as(
 select g.*
 from groups g join snapshot_months s on s.month_start=g.month_start
 and g.units=s.units and g.product_revenue=s.product_revenue
 and g.orders=s.net_orders
),selected as(
 select distinct on(month_start) * from validated
 order by month_start,snapshot_id desc
),financial_days as(
 select d.*,o.listing_id
 from public.commerce_shopee_finance_sku_daily_stage_v1 d
 join public.commerce_sales_import_batches b on b.id=d.batch_id
 join selected s on s.month_start=date_trunc('month',d.sale_date)::date
   and s.snapshot_id=b.snapshot_id
 join(
   select source_sku_norm,min(listing_id) listing_id
   from public.commerce_shopee_sku_owner_reviewed_v1 group by 1 having count(*)=1
 )o on o.source_sku_norm=d.sku_norm
 cross join bounds win
 where d.sale_date between win.period_start and win.period_end
  and o.listing_id=p_listing_id
),summary as(
 select coalesce(sum(orders),0)::bigint fee_orders,
 coalesce(sum(units),0)::bigint units,
 coalesce(round(sum(product_revenue),2),0)::numeric(18,2) subtotal,
 coalesce(round(sum(seller_discount),2),0)::numeric(18,2) seller_discount,
 coalesce(round(sum(commission_net),2),0)::numeric(18,2) commission,
 coalesce(round(sum(service_net),2),0)::numeric(18,2) service,
 coalesce(round(sum(transaction_fee),2),0)::numeric(18,2) transaction
 from financial_days
),coverage as(
 select count(*)::int financial_months,
 coalesce(sum(fee_orders),0)::bigint shop_fee_orders,
 coalesce(sum(unallocated_orders),0)::bigint shop_unallocated_orders
 from selected
),expected as(select count(*)::int months from snapshot_months),
eligibility as(
 select exists(
  select 1 from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where l.id=p_listing_id and m.code='SHOPEE' and l.listing_status='ACTIVE'
 ) valid
)
select jsonb_build_object(
 'period_start',(select period_start from bounds),
 'period_end',(select period_end from bounds),
 'status',case when not(select valid from eligibility) then 'INVALID_LISTING'
   when (select financial_months from coverage)=0 then 'NOT_IMPORTED'
   when (select financial_months from coverage)<(select months from expected)
     then 'PARTIAL_MONTHS' else 'AVAILABLE' end,
 'financial_months',(select financial_months from coverage),
 'expected_months',(select months from expected),
 'shop_fee_orders',(select shop_fee_orders from coverage),
 'shop_unallocated_orders',(select shop_unallocated_orders from coverage),
 'fee_orders',(select fee_orders from summary),
 'units',(select units from summary),
 'subtotal',(select subtotal from summary),
 'seller_discount',(select seller_discount from summary),
 'commission',(select commission from summary),
 'service',(select service from summary),
 'transaction',(select transaction from summary),
 'after_fees',(select subtotal-commission-service-transaction from summary),
 'discount_already_in_subtotal',true,
 'not_a_payout',true
);
$fn$;
revoke all on function public.commerce_shopee_finance_report_v1(bigint,text,integer)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_finance_report_v1(bigint,text,integer)
 to service_role;
