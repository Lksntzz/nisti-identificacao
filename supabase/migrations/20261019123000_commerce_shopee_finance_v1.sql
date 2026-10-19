-- Shopee financial evidence. Only aggregated amounts cross the client API.
-- Commission/transaction/service fees appear on EVERY item line in the
-- official XLSX and are de-duplicated by order before being staged.
-- Seller discount is a per-item figure ALREADY reflected in subtotal:
-- NEVER subtract it twice. Mixed-SKU order fees stay at month scope.
create table if not exists public.commerce_shopee_finance_month_v1 (
 batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
 month_start date not null,
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
 primary key(batch_id,month_start),
 check (fee_orders<=orders and single_sku_fee_orders<=fee_orders),
 check (unallocated_orders<=orders and unallocated_units<=units)
);
create table if not exists public.commerce_shopee_finance_sku_day_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
 sale_date date not null,
 sku_norm text not null check(length(sku_norm) between 1 and 160),
 orders integer not null check(orders>=0),
 units integer not null check(units>=0),
 product_revenue numeric(18,2) not null,
 seller_discount numeric(18,2) not null,
 transaction_fee numeric(18,2) not null,
 commission_net numeric(18,2) not null,
 service_net numeric(18,2) not null,
 primary key(batch_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_sku_day_date_idx
 on public.commerce_shopee_finance_sku_day_v1(sale_date,sku_norm);
create index if not exists commerce_shopee_finance_month_date_idx
 on public.commerce_shopee_finance_month_v1(month_start,batch_id);
alter table public.commerce_shopee_finance_month_v1 enable row level security;
alter table public.commerce_shopee_finance_sku_day_v1 enable row level security;
revoke all on public.commerce_shopee_finance_month_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_sku_day_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_month_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_sku_day_v1 to service_role;

create or replace function public.commerce_append_shopee_finance_v1(
 p_batch_id bigint,p_kind text,p_rows jsonb
) returns integer language plpgsql volatile security invoker set search_path=public as $function$
declare v_status text;v_platform text;v_count integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array'
  or jsonb_array_length(p_rows) not between 1 and 100
 then raise exception 'Financeiro Shopee: informe entre 1 e 100 linhas.';end if;
 select status,platform_code into v_status,v_platform
 from public.commerce_sales_import_batches where id=p_batch_id for update;
 if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
 then raise exception 'O lote Shopee não está aberto para dados financeiros.';end if;
 if p_kind='MONTH' then
   if exists(
     select 1 from jsonb_array_elements(p_rows) x
     where x->>'month_start' !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
       or nullif(x->>'orders','') is null
       or nullif(x->>'units','') is null
   ) then raise exception 'Mês financeiro inválido.';end if;
   insert into public.commerce_shopee_finance_month_v1(
    batch_id,month_start,orders,units,product_revenue,seller_discount,
    transaction_fee,commission_net,service_net,fee_orders,
    single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue
   ) select p_batch_id,(x->>'month_start')::date,(x->>'orders')::integer,
    (x->>'units')::integer,(x->>'product_revenue')::numeric,
    (x->>'seller_discount')::numeric,(x->>'transaction_fee')::numeric,
    (x->>'commission_net')::numeric,(x->>'service_net')::numeric,
    (x->>'fee_orders')::integer,(x->>'single_sku_fee_orders')::integer,
    (x->>'unallocated_orders')::integer,(x->>'unallocated_units')::integer,
    (x->>'unallocated_revenue')::numeric
   from jsonb_array_elements(p_rows) x
   on conflict(batch_id,month_start) do update set
    orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
    seller_discount=excluded.seller_discount,transaction_fee=excluded.transaction_fee,
    commission_net=excluded.commission_net,service_net=excluded.service_net,
    fee_orders=excluded.fee_orders,single_sku_fee_orders=excluded.single_sku_fee_orders,
    unallocated_orders=excluded.unallocated_orders,
    unallocated_units=excluded.unallocated_units,unallocated_revenue=excluded.unallocated_revenue;
 elsif p_kind='SKU_DAY' then
   if exists(
    select 1 from jsonb_array_elements(p_rows) x
    where (x->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or nullif(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),'') is null
      or length(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'))>160
   ) then raise exception 'Linha financeira diária inválida.';end if;
   insert into public.commerce_shopee_finance_sku_day_v1(
    batch_id,sale_date,sku_norm,orders,units,product_revenue,
    seller_discount,transaction_fee,commission_net,service_net
   ) select p_batch_id,(x->>'sale_date')::date,
    public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),
    (x->>'orders')::integer,(x->>'units')::integer,
    (x->>'product_revenue')::numeric,(x->>'seller_discount')::numeric,
    (x->>'transaction_fee')::numeric,(x->>'commission_net')::numeric,
    (x->>'service_net')::numeric
   from jsonb_array_elements(p_rows) x
   on conflict(batch_id,sale_date,sku_norm) do update set
    orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
    seller_discount=excluded.seller_discount,transaction_fee=excluded.transaction_fee,
    commission_net=excluded.commission_net,service_net=excluded.service_net;
 else raise exception 'Tipo financeiro inválido.';end if;
 get diagnostics v_count=row_count;
 return v_count;
end $function$;
revoke all on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb)
 from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_finance_v1(bigint,text,jsonb)
 to service_role;

-- Use only the latest committed financial import for each month. Distinct
-- parts of the same source batch group share a snapshot ID and all count.
-- Snapshot copies for another month do not invalidate historical source data.
create or replace function public.commerce_shopee_listing_finance_v1(
 p_listing_id bigint,p_start date,p_end date
) returns jsonb language sql stable security invoker set search_path=public as $function$
with input as (
 select p_listing_id as listing_id,p_start as first_day,p_end as last_day
 where p_listing_id>0 and p_start is not null and p_end>=p_start
   and p_end-p_start between 0 and 369
), latest as (
 select fm.month_start,max(b.snapshot_id) snapshot_id
 from public.commerce_shopee_finance_month_v1 fm
 join public.commerce_sales_import_batches b on b.id=fm.batch_id
 cross join input i
 where b.status='COMMITTED' and b.platform_code='SHOPEE'
   and fm.month_start between date_trunc('month',i.first_day)::date
      and date_trunc('month',i.last_day)::date
 group by fm.month_start
), sources as (
 select fm.batch_id,fm.month_start
 from public.commerce_shopee_finance_month_v1 fm
 join public.commerce_sales_import_batches b on b.id=fm.batch_id
 join latest l on l.month_start=fm.month_start and b.snapshot_id=l.snapshot_id
), source_totals as (
 select count(distinct fm.month_start)::integer financial_months,
   coalesce(sum(fm.orders),0)::integer all_orders,
   coalesce(sum(fm.fee_orders),0)::integer validated_fee_orders,
   coalesce(sum(fm.single_sku_fee_orders),0)::integer single_sku_fee_orders,
   coalesce(sum(fm.unallocated_orders),0)::integer unallocated_orders,
   coalesce(sum(fm.unallocated_units),0)::integer unallocated_units,
   coalesce(sum(fm.product_revenue),0)::numeric source_subtotal,
   coalesce(sum(fm.seller_discount),0)::numeric source_discount,
   coalesce(sum(fm.commission_net),0)::numeric all_commission,
   coalesce(sum(fm.service_net),0)::numeric all_service,
   coalesce(sum(fm.transaction_fee),0)::numeric all_transaction
 from public.commerce_shopee_finance_month_v1 fm
 join sources src on src.batch_id=fm.batch_id and src.month_start=fm.month_start
), associated as (
 select coalesce(sum(f.units),0)::integer attributable_units,
   coalesce(sum(f.orders),0)::integer fee_covered_orders,
   coalesce(sum(f.product_revenue),0)::numeric fee_covered_subtotal,
   coalesce(sum(f.seller_discount),0)::numeric seller_discount_included,
   coalesce(sum(f.commission_net),0)::numeric commission_net,
   coalesce(sum(f.service_net),0)::numeric service_net,
   coalesce(sum(f.transaction_fee),0)::numeric transaction_fee
 from public.commerce_shopee_finance_sku_day_v1 f
 join sources src on src.batch_id=f.batch_id
   and src.month_start=date_trunc('month',f.sale_date)::date
 join public.commerce_shopee_sku_owner_reviewed_v1 o
   on o.source_sku_norm=f.sku_norm
 join input i on o.listing_id=i.listing_id
   and f.sale_date between i.first_day and i.last_day
)
select case when (select count(*) from sources)=0 then
 jsonb_build_object('available',false,'reason','FINANCIAL_IMPORT_REQUIRED')
 else jsonb_build_object(
 'available',true,'source','SHOPEE_SELLER_XLSX',
 'financial_months',t.financial_months,
 'seller_discount_in_subtotal',a.seller_discount_included,
 'commission_net',a.commission_net,'service_net',a.service_net,
 'transaction_fee',a.transaction_fee,
 'fee_covered_orders',a.fee_covered_orders,
 'fee_covered_units',a.attributable_units,
 'fee_covered_subtotal',a.fee_covered_subtotal,
 'after_identified_fees',a.fee_covered_subtotal
   -a.commission_net-a.service_net-a.transaction_fee,
 'fees_allocated_to_single_sku_only',true,
 'seller_discount_already_in_subtotal',true,
 'financial_source_orders',t.all_orders,
 'financial_source_fee_orders',t.validated_fee_orders,
 'unallocated_order_count',t.unallocated_orders,
 'unallocated_units',t.unallocated_units,
 'partial',t.validated_fee_orders<t.all_orders
   or t.unallocated_orders>0
 )
 end
from source_totals t,associated a
$function$;
revoke all on function public.commerce_shopee_listing_finance_v1(bigint,date,date)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_listing_finance_v1(bigint,date,date)
 to service_role;
