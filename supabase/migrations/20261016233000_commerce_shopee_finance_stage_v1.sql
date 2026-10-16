-- Financial evidence is independent of sales snapshots and never edits
-- source orders or scanner products. Hashed order keys allow cross-part
-- duplicate detection without retaining buyer or original order identifiers.
create table if not exists public.commerce_shopee_financial_orders_v1(
  batch_id bigint not null references public.commerce_sales_import_batches(id),
  order_hash text not null check(order_hash ~ '^[a-f0-9]{64}$'),
  month_start date not null,
  sale_date date not null,
  sku_norm text,
  sku_count integer not null check(sku_count between 1 and 500),
  source_rows integer not null check(source_rows between 1 and 1000),
  units integer not null check(units between 1 and 100000),
  product_revenue numeric(18,2) not null check(product_revenue>=0),
  seller_discount numeric(18,2) not null default 0,
  transaction_fee numeric(18,2),
  commission_net numeric(18,2),
  service_net numeric(18,2),
  fee_valid boolean not null default false,
  received_at timestamptz not null default now(),
  primary key(batch_id,order_hash),
  constraint finance_month_equals_date check(date_trunc('month',sale_date)::date=month_start),
  constraint finance_one_sku check ((sku_count=1 and sku_norm is not null)
    or (sku_count>1 and sku_norm is null)),
  constraint finance_fee_consistency check (
    fee_valid=false or
      (transaction_fee is not null and commission_net is not null and service_net is not null))
);
create index if not exists commerce_shopee_finance_month_idx
  on public.commerce_shopee_financial_orders_v1(month_start,sale_date);
alter table public.commerce_shopee_financial_orders_v1 enable row level security;
revoke all on public.commerce_shopee_financial_orders_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_financial_orders_v1 to service_role;

create or replace function public.commerce_append_shopee_financial_orders_v1(
 p_batch_id bigint,p_rows jsonb
) returns integer language plpgsql volatile security invoker set search_path=public as $fn$
declare v_status text;v_platform text;v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100
    then raise exception 'Informe entre 1 e 100 pedidos financeiros.';end if;
  select status,platform_code into v_status,v_platform
    from public.commerce_sales_import_batches where id=p_batch_id for update;
  if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
    then raise exception 'Lote Shopee inexistente ou encerrado.';end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where
     coalesce(r->>'order_hash','') !~ '^[a-f0-9]{64}$'
     or coalesce(r->>'month_start','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$'
     or coalesce(r->>'sale_date','') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
     or coalesce(r->>'sku_count','') !~ '^[1-9][0-9]{0,2}$'
     or coalesce(r->>'source_rows','') !~ '^[1-9][0-9]{0,3}$'
     or coalesce(r->>'units','') !~ '^[1-9][0-9]{0,5}$'
     or coalesce(r->>'product_revenue','') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
     or coalesce(r->>'seller_discount','') !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
     or jsonb_typeof(r->'fee_valid') is distinct from 'boolean'
     or (coalesce((r->>'sku_count')::integer,0)=1 and
        nullif(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),'') is null)
     or (coalesce((r->>'sku_count')::integer,0)>1 and r->>'sku_norm' is not null)
     or (r->>'fee_valid'='true' and
      (coalesce(r->>'transaction_fee','') !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
      or coalesce(r->>'commission_net','') !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'
      or coalesce(r->>'service_net','') !~ '^-?[0-9]{1,10}(\.[0-9]{1,2})?$'))
  ) then raise exception 'Dados financeiros Shopee inválidos ou incompletos.';end if;
  insert into public.commerce_shopee_financial_orders_v1(
    batch_id,order_hash,month_start,sale_date,sku_norm,sku_count,source_rows,
    units,product_revenue,seller_discount,transaction_fee,commission_net,service_net,fee_valid)
  select p_batch_id,r->>'order_hash',(r->>'month_start')::date,(r->>'sale_date')::date,
    case when (r->>'sku_count')::integer=1 then public.commerce_nisti_sku_norm_v1(r->>'sku_norm')
      else null end,
    (r->>'sku_count')::integer,(r->>'source_rows')::integer,(r->>'units')::integer,
    (r->>'product_revenue')::numeric,(r->>'seller_discount')::numeric,
    nullif(r->>'transaction_fee','')::numeric,nullif(r->>'commission_net','')::numeric,
    nullif(r->>'service_net','')::numeric,(r->>'fee_valid')::boolean
  from jsonb_array_elements(p_rows) r
  on conflict(batch_id,order_hash) do update set
    sale_date=excluded.sale_date,month_start=excluded.month_start,
    sku_norm=excluded.sku_norm,sku_count=excluded.sku_count,
    source_rows=excluded.source_rows,units=excluded.units,
    product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
    transaction_fee=excluded.transaction_fee,commission_net=excluded.commission_net,
    service_net=excluded.service_net,fee_valid=excluded.fee_valid;
  get diagnostics v_count=row_count;
  return v_count;
end $fn$;
revoke all on function public.commerce_append_shopee_financial_orders_v1(bigint,jsonb)
  from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_financial_orders_v1(bigint,jsonb)
  to service_role;
