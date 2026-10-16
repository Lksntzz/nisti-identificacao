-- Financial evidence from the official Shopee order export, separate from the
-- commercial sales snapshot. Do not reconstruct or overwrite sales/Scanner.
-- Only seller-discount and net fee columns explicitly reported by Shopee.
-- Commission/service/transaction are order-level and deduplicated before upload.
create table if not exists public.commerce_shopee_finance_month_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
 month_start date not null,
 orders integer not null check(orders>=0),
 units bigint not null check(units>=0),
 product_revenue numeric(18,2) not null check(product_revenue>=0),
 seller_discount numeric(18,2) not null check(seller_discount>=0),
 transaction_fee numeric(18,2) not null check(transaction_fee>=0),
 commission_net numeric(18,2) not null check(commission_net>=0),
 service_net numeric(18,2) not null check(service_net>=0),
 fee_orders integer not null check(fee_orders>=0),
 single_sku_fee_orders integer not null check(single_sku_fee_orders>=0),
 unallocated_orders integer not null check(unallocated_orders>=0),
 unallocated_units bigint not null check(unallocated_units>=0),
 unallocated_revenue numeric(18,2) not null check(unallocated_revenue>=0),
 primary key(batch_id,month_start),
 check(date_trunc('month',month_start)::date=month_start),
 check(fee_orders<=orders and single_sku_fee_orders<=fee_orders
       and unallocated_orders<=orders and unallocated_units<=units)
);
create table if not exists public.commerce_shopee_finance_sku_daily_v1(
 batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
 sale_date date not null,sku_norm text not null check(length(sku_norm) between 1 and 160),
 orders integer not null check(orders>=0),
 units bigint not null check(units>=0),
 product_revenue numeric(18,2) not null check(product_revenue>=0),
 seller_discount numeric(18,2) not null check(seller_discount>=0),
 transaction_fee numeric(18,2) not null check(transaction_fee>=0),
 commission_net numeric(18,2) not null check(commission_net>=0),
 service_net numeric(18,2) not null check(service_net>=0),
 primary key(batch_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_month_period_idx
 on public.commerce_shopee_finance_month_v1(month_start,batch_id);
create index if not exists commerce_shopee_finance_sku_period_idx
 on public.commerce_shopee_finance_sku_daily_v1(sale_date,sku_norm,batch_id);
alter table public.commerce_shopee_finance_month_v1 enable row level security;
alter table public.commerce_shopee_finance_sku_daily_v1 enable row level security;
revoke all on public.commerce_shopee_finance_month_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_sku_daily_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_month_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_sku_daily_v1 to service_role;

create or replace function public.commerce_append_shopee_finance_month_v1(
 p_batch_id bigint,p_rows jsonb
) returns integer language plpgsql volatile security invoker set search_path=public as $fn$
declare v_status text;v_platform text;v_count integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 100 then
   raise exception 'Informe entre 1 e 100 totais financeiros mensais.';end if;
 select status,platform_code into v_status,v_platform
 from public.commerce_sales_import_batches where id=p_batch_id for update;
 if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
   then raise exception 'Lote financeiro Shopee não está aberto.';end if;
 insert into public.commerce_shopee_finance_month_v1(
 batch_id,month_start,orders,units,product_revenue,seller_discount,
 transaction_fee,commission_net,service_net,fee_orders,
 single_sku_fee_orders,unallocated_orders,unallocated_units,unallocated_revenue)
 select p_batch_id,r.month_start,r.orders,r.units,r.product_revenue,r.seller_discount,
  r.transaction_fee,r.commission_net,r.service_net,r.fee_orders,
  r.single_sku_fee_orders,r.unallocated_orders,r.unallocated_units,r.unallocated_revenue
 from jsonb_to_recordset(p_rows) as r(
  month_start date,orders integer,units bigint,product_revenue numeric,
  seller_discount numeric,transaction_fee numeric,commission_net numeric,
  service_net numeric,fee_orders integer,single_sku_fee_orders integer,
  unallocated_orders integer,unallocated_units bigint,unallocated_revenue numeric)
 on conflict(batch_id,month_start) do update set
  orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
  seller_discount=excluded.seller_discount,transaction_fee=excluded.transaction_fee,
  commission_net=excluded.commission_net,service_net=excluded.service_net,
  fee_orders=excluded.fee_orders,single_sku_fee_orders=excluded.single_sku_fee_orders,
  unallocated_orders=excluded.unallocated_orders,unallocated_units=excluded.unallocated_units,
  unallocated_revenue=excluded.unallocated_revenue;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;

create or replace function public.commerce_append_shopee_finance_daily_v1(
 p_batch_id bigint,p_rows jsonb
) returns integer language plpgsql volatile security invoker set search_path=public as $fn$
declare v_status text;v_platform text;v_count integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 100 then
   raise exception 'Informe entre 1 e 100 registros financeiros por SKU e dia.';end if;
 select status,platform_code into v_status,v_platform
 from public.commerce_sales_import_batches where id=p_batch_id for update;
 if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
   then raise exception 'Lote financeiro Shopee não está aberto.';end if;
 if exists(select 1 from jsonb_array_elements(p_rows) r
     where nullif(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),'') is null
        or length(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'))>160)
 then raise exception 'SKU financeiro inválido.';end if;
 insert into public.commerce_shopee_finance_sku_daily_v1(
 batch_id,sale_date,sku_norm,orders,units,product_revenue,seller_discount,
 transaction_fee,commission_net,service_net)
 select p_batch_id,r.sale_date,
  public.commerce_nisti_sku_norm_v1(r.sku_norm),
  r.orders,r.units,r.product_revenue,r.seller_discount,
  r.transaction_fee,r.commission_net,r.service_net
 from jsonb_to_recordset(p_rows) as r(
  sale_date date,sku_norm text,orders integer,units bigint,product_revenue numeric,
  seller_discount numeric,transaction_fee numeric,commission_net numeric,service_net numeric)
 on conflict(batch_id,sale_date,sku_norm) do update set
  orders=excluded.orders,units=excluded.units,product_revenue=excluded.product_revenue,
  seller_discount=excluded.seller_discount,transaction_fee=excluded.transaction_fee,
  commission_net=excluded.commission_net,service_net=excluded.service_net;
 get diagnostics v_count=row_count;
 return v_count;
end $fn$;

revoke all on function public.commerce_append_shopee_finance_month_v1(bigint,jsonb)
 from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_finance_month_v1(bigint,jsonb) to service_role;
revoke all on function public.commerce_append_shopee_finance_daily_v1(bigint,jsonb)
 from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_finance_daily_v1(bigint,jsonb) to service_role;
