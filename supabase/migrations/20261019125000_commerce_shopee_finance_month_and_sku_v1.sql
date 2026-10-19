-- Shopee financial data stays separate from immutable sales snapshots.
-- The source XLSX repeats commission/service charges on every item row of an
-- order. Client aggregation deduplicates at order scope BEFORE uploading.
-- No order identifiers, names, addresses or other buyer data are persisted.
create table if not exists public.commerce_shopee_finance_month_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id),
  month_start date not null,
  period_end date not null,
  orders integer not null check(orders>=0),
  units integer not null check(units>=0),
  product_revenue numeric(18,2) not null,
  seller_discount numeric(18,2) not null,
  commission_net numeric(18,2) not null,
  service_net numeric(18,2) not null,
  transaction_fee numeric(18,2) not null,
  fee_orders integer not null check(fee_orders>=0),
  single_sku_fee_orders integer not null check(single_sku_fee_orders>=0),
  unallocated_orders integer not null check(unallocated_orders>=0),
  unallocated_units integer not null check(unallocated_units>=0),
  unallocated_revenue numeric(18,2) not null,
  created_at timestamptz not null default now(),
  primary key(batch_id,month_start),
  check (month_start=date_trunc('month',month_start)::date),
  check (period_end>=month_start and period_end<(month_start+interval '1 month')::date),
  check (single_sku_fee_orders<=fee_orders and fee_orders<=orders),
  check (single_sku_fee_orders+unallocated_orders=orders)
);
create table if not exists public.commerce_shopee_finance_sku_daily_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id),
  sale_date date not null,
  sku_norm text not null check(length(sku_norm) between 1 and 160),
  orders integer not null check(orders>=0),
  units integer not null check(units>=0),
  product_revenue numeric(18,2) not null,
  seller_discount numeric(18,2) not null,
  commission_net numeric(18,2) not null,
  service_net numeric(18,2) not null,
  transaction_fee numeric(18,2) not null,
  created_at timestamptz not null default now(),
  primary key(batch_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_sku_day_idx
 on public.commerce_shopee_finance_sku_daily_v1(sale_date,sku_norm);
create index if not exists commerce_shopee_finance_month_idx
 on public.commerce_shopee_finance_month_v1(month_start,batch_id);
alter table public.commerce_shopee_finance_month_v1 enable row level security;
alter table public.commerce_shopee_finance_sku_daily_v1 enable row level security;
revoke all on public.commerce_shopee_finance_month_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_sku_daily_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_month_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_sku_daily_v1 to service_role;

create or replace function public.commerce_shopee_append_finance_v1(
 p_batch_id bigint,p_kind text,p_rows jsonb
) returns integer language plpgsql volatile security invoker set search_path=public as $fn$
declare b public.commerce_sales_import_batches%rowtype;v_count integer;
begin
 if p_kind not in ('MONTH','DAILY') or jsonb_typeof(p_rows) is distinct from 'array'
   or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Formato de importação financeira inválido.';end if;
 select * into b from public.commerce_sales_import_batches where id=p_batch_id for update;
 if b.id is null or b.platform_code<>'SHOPEE' or b.status not in ('STAGED','COMMITTED')
   or nullif(b.source_sha256,'') is null then
   raise exception 'Importação financeira exige lote Shopee válido e arquivo de origem identificado.';end if;
 if p_kind='MONTH' then
   if exists(select 1 from jsonb_array_elements(p_rows) x
      where (x->>'month_start') !~ '^20[0-9]{2}-[0-9]{2}-01$'
      or (x->>'period_end') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or (x->>'orders') !~ '^[0-9]{1,8}$'
      or (x->>'units') !~ '^[0-9]{1,8}$'
      or (x->>'fee_orders') !~ '^[0-9]{1,8}$'
      or (x->>'single_sku_fee_orders') !~ '^[0-9]{1,8}$'
      or (x->>'unallocated_orders') !~ '^[0-9]{1,8}$'
      or (x->>'unallocated_units') !~ '^[0-9]{1,8}$')
   then raise exception 'Resumo financeiro inválido.';end if;
   insert into public.commerce_shopee_finance_month_v1(
     batch_id,month_start,period_end,orders,units,product_revenue,seller_discount,
     commission_net,service_net,transaction_fee,fee_orders,single_sku_fee_orders,
     unallocated_orders,unallocated_units,unallocated_revenue
   )
   select p_batch_id,(x->>'month_start')::date,(x->>'period_end')::date,
     (x->>'orders')::integer,(x->>'units')::integer,(x->>'product_revenue')::numeric,
     (x->>'seller_discount')::numeric,(x->>'commission_net')::numeric,
     (x->>'service_net')::numeric,(x->>'transaction_fee')::numeric,
     (x->>'fee_orders')::integer,(x->>'single_sku_fee_orders')::integer,
     (x->>'unallocated_orders')::integer,(x->>'unallocated_units')::integer,
     (x->>'unallocated_revenue')::numeric
   from jsonb_array_elements(p_rows) x
   on conflict(batch_id,month_start) do update set
     period_end=excluded.period_end,orders=excluded.orders,units=excluded.units,
     product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
     commission_net=excluded.commission_net,service_net=excluded.service_net,
     transaction_fee=excluded.transaction_fee,fee_orders=excluded.fee_orders,
     single_sku_fee_orders=excluded.single_sku_fee_orders,
     unallocated_orders=excluded.unallocated_orders,
     unallocated_units=excluded.unallocated_units,unallocated_revenue=excluded.unallocated_revenue;
 else
   if exists(select 1 from jsonb_array_elements(p_rows) x
      where (x->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
       or nullif(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),'') is null
       or length(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'))>160
       or (x->>'orders') !~ '^[0-9]{1,8}$'
       or (x->>'units') !~ '^[0-9]{1,8}$')
     then raise exception 'Linhas financeiras por SKU inválidas.';end if;
   insert into public.commerce_shopee_finance_sku_daily_v1(
    batch_id,sale_date,sku_norm,orders,units,product_revenue,seller_discount,
    commission_net,service_net,transaction_fee
   )
   select p_batch_id,(x->>'sale_date')::date,
     public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),
     (x->>'orders')::integer,(x->>'units')::integer,
     (x->>'product_revenue')::numeric,(x->>'seller_discount')::numeric,
     (x->>'commission_net')::numeric,(x->>'service_net')::numeric,
     (x->>'transaction_fee')::numeric
   from jsonb_array_elements(p_rows) x
   on conflict(batch_id,sale_date,sku_norm) do update set
     orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
     seller_discount=excluded.seller_discount,commission_net=excluded.commission_net,
     service_net=excluded.service_net,transaction_fee=excluded.transaction_fee;
 end if;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;

-- Only use complete month rollups whose SKU totals exactly reconcile to the
-- current Shopee import. A partial/old upload never appears as the current month.
create or replace function public.commerce_shopee_finance_read_v1(
 p_month text,p_listing_id bigint default null
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with monthly_sales as (
 select s.period_start,s.period_end,s.units,s.product_revenue
 from public.commerce_sales_summary_rows s
 join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current
 where s.platform_code='SHOPEE' and to_char(s.period_start,'YYYY-MM')=p_month
), month_groups as (
 select m.month_start,m.period_end,b.snapshot_id,
   sum(m.orders)::bigint orders,sum(m.units)::bigint units,
   round(sum(m.product_revenue),2) product_revenue,
   round(sum(m.seller_discount),2) seller_discount,
   round(sum(m.commission_net),2) commission_net,
   round(sum(m.service_net),2) service_net,
   round(sum(m.transaction_fee),2) transaction_fee,
   sum(m.fee_orders)::bigint fee_orders,
   sum(m.single_sku_fee_orders)::bigint single_sku_fee_orders,
   sum(m.unallocated_orders)::bigint unallocated_orders,
   sum(m.unallocated_units)::bigint unallocated_units
 from public.commerce_shopee_finance_month_v1 m
 join public.commerce_sales_import_batches b on b.id=m.batch_id
 where b.status='COMMITTED' and b.platform_code='SHOPEE'
   and to_char(m.month_start,'YYYY-MM')=p_month
 group by m.month_start,m.period_end,b.snapshot_id
), selected as(
 select m.* from month_groups m join monthly_sales s on
   s.period_start=m.month_start and s.period_end=m.period_end
   and s.units=m.units and abs(s.product_revenue-m.product_revenue)<0.01
 order by m.snapshot_id desc limit 1
), unique_owners as (
 select source_sku_norm,min(listing_id) listing_id
 from public.commerce_shopee_sku_owner_reviewed_v1
 group by source_sku_norm having count(*)=1
), listing_finance as (
 select count(distinct f.sale_date)::int matched_days,
   coalesce(sum(f.orders),0)::bigint orders,
   coalesce(sum(f.units),0)::bigint units,
   coalesce(round(sum(f.product_revenue),2),0)::numeric product_revenue,
   coalesce(round(sum(f.seller_discount),2),0)::numeric seller_discount,
   coalesce(round(sum(f.commission_net),2),0)::numeric commission_net,
   coalesce(round(sum(f.service_net),2),0)::numeric service_net,
   coalesce(round(sum(f.transaction_fee),2),0)::numeric transaction_fee
 from public.commerce_shopee_finance_sku_daily_v1 f
 join public.commerce_sales_import_batches b on b.id=f.batch_id
 join selected s on s.snapshot_id=b.snapshot_id
   and f.sale_date between s.month_start and s.period_end
 join unique_owners u on u.source_sku_norm=f.sku_norm and u.listing_id=p_listing_id
 where p_listing_id is not null and b.status='COMMITTED'
), result as(
 select s.*, (select to_jsonb(f) from listing_finance f) listing_data
 from selected s
)
select coalesce((select jsonb_build_object(
 'status','AVAILABLE','month',p_month,'period_end',period_end,
 'orders',orders,'units',units,'product_revenue',product_revenue,
 'seller_discount',seller_discount,'commission_net',commission_net,
 'service_net',service_net,'transaction_fee',transaction_fee,
 'fee_orders',fee_orders,'single_sku_fee_orders',single_sku_fee_orders,
 'unallocated_orders',unallocated_orders,'unallocated_units',unallocated_units,
 'fee_coverage_pct',case when orders>0 then round(100.0*fee_orders/orders,2) end,
 'listing',listing_data
) from result),jsonb_build_object('status','NOT_IMPORTED','month',p_month))
$fn$;
revoke all on function public.commerce_shopee_append_finance_v1(bigint,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_append_finance_v1(bigint,text,jsonb) to service_role;
revoke all on function public.commerce_shopee_finance_read_v1(text,bigint)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_finance_read_v1(text,bigint) to service_role;
