-- Shopee: dados extras dos pedidos (preço praticado, cancelamento, frete, cashback, UF), resumidos por dia e SKU.
-- Tabela nova e independente: nenhuma tabela ou view de vendas existente é alterada.
-- Nenhum dado de pedido ou comprador chega ao banco; só somas por dia e SKU.
create table if not exists public.commerce_shopee_order_extras_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,
  sku_norm text not null,
  units integer not null default 0,
  price_orig_sum numeric(14,2) not null default 0,
  price_paid_sum numeric(14,2) not null default 0,
  price_paid_min numeric(12,2),
  price_paid_max numeric(12,2),
  cancelled_units integer not null default 0,
  cancelled_orders integer not null default 0,
  cancel_reasons jsonb not null default '{}'::jsonb,
  ship_orders integer not null default 0,
  ship_est numeric(14,2) not null default 0,
  ship_paid numeric(14,2) not null default 0,
  cashback_seller numeric(14,2) not null default 0,
  uf_units jsonb not null default '{}'::jsonb,
  primary key (batch_id, sale_date, sku_norm)
);
create index if not exists commerce_shopee_order_extras_daily_lookup
  on public.commerce_shopee_order_extras_daily_v1 (sku_norm, sale_date);
alter table public.commerce_shopee_order_extras_daily_v1 enable row level security;
revoke all on public.commerce_shopee_order_extras_daily_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_shopee_order_extras_daily_v1 to service_role;

create or replace function public.commerce_append_shopee_order_extras_v1(p_batch_id bigint, p_rows jsonb)
returns integer language plpgsql security invoker set search_path=public as $fn$
declare v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>100
  then raise exception 'order_extras_rows deve conter 1 a 100 linhas.'; end if;
  if not exists(select 1 from public.commerce_sales_import_batches b
    where b.id=p_batch_id and b.platform_code='SHOPEE' and b.status in ('UPLOADED','STAGED'))
  then raise exception 'Lote de vendas Shopee inválido ou fechado.'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where
    (r->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    or nullif(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),'') is null
    or coalesce((r->>'units')::integer,-1)<0
    or coalesce((r->>'cancelled_units')::integer,-1)<0
    or coalesce((r->>'price_orig_sum')::numeric,-1)<0
    or coalesce((r->>'price_paid_sum')::numeric,-1)<0
    or coalesce((r->>'ship_est')::numeric,-1)<0
    or coalesce((r->>'ship_paid')::numeric,-1)<0
    or coalesce((r->>'cashback_seller')::numeric,-1)<0
    or jsonb_typeof(coalesce(r->'cancel_reasons','{}'::jsonb)) is distinct from 'object'
    or jsonb_typeof(coalesce(r->'uf_units','{}'::jsonb)) is distinct from 'object')
  then raise exception 'Dados extras de pedidos Shopee inválidos.'; end if;
  insert into public.commerce_shopee_order_extras_daily_v1(
    batch_id,sale_date,sku_norm,units,price_orig_sum,price_paid_sum,price_paid_min,price_paid_max,
    cancelled_units,cancelled_orders,cancel_reasons,ship_orders,ship_est,ship_paid,cashback_seller,uf_units)
  select p_batch_id,(r->>'sale_date')::date,public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),
    (r->>'units')::integer,(r->>'price_orig_sum')::numeric,(r->>'price_paid_sum')::numeric,
    nullif(r->>'price_paid_min','')::numeric,nullif(r->>'price_paid_max','')::numeric,
    (r->>'cancelled_units')::integer,coalesce((r->>'cancelled_orders')::integer,0),
    coalesce(r->'cancel_reasons','{}'::jsonb),coalesce((r->>'ship_orders')::integer,0),
    (r->>'ship_est')::numeric,(r->>'ship_paid')::numeric,(r->>'cashback_seller')::numeric,
    coalesce(r->'uf_units','{}'::jsonb)
  from jsonb_array_elements(p_rows) r
  on conflict(batch_id,sale_date,sku_norm) do update set
    units=excluded.units,price_orig_sum=excluded.price_orig_sum,price_paid_sum=excluded.price_paid_sum,
    price_paid_min=excluded.price_paid_min,price_paid_max=excluded.price_paid_max,
    cancelled_units=excluded.cancelled_units,cancelled_orders=excluded.cancelled_orders,
    cancel_reasons=excluded.cancel_reasons,ship_orders=excluded.ship_orders,ship_est=excluded.ship_est,
    ship_paid=excluded.ship_paid,cashback_seller=excluded.cashback_seller,uf_units=excluded.uf_units;
  get diagnostics v_count=row_count;
  return v_count;
end $fn$;
revoke all on function public.commerce_append_shopee_order_extras_v1(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_order_extras_v1(bigint,jsonb) to service_role;

-- Lote mais novo substitui os mesmos dias dos extras de lotes de snapshots mais antigos.
-- Definição abaixo = a atual em produção (06/11/2026) + o último bloco (extras).
create or replace function public.commerce_shopee_supersede_old_days_v1()
returns trigger language plpgsql set search_path to 'public' as $fn$
begin
  if new.platform_code is distinct from 'SHOPEE' or new.snapshot_id is null then return new; end if;
  with gone as (
    delete from public.commerce_shopee_sales_sku_daily_v1 d
    using public.commerce_sales_import_batches ob
    where d.batch_id=ob.id and ob.platform_code='SHOPEE' and ob.status='COMMITTED'
      and ob.snapshot_id is not null and ob.snapshot_id<new.snapshot_id
      and d.sale_date in (select n.sale_date from public.commerce_shopee_sales_sku_daily_v1 n where n.batch_id=new.id)
    returning d.*
  ) insert into public.commerce_shopee_sku_daily_superseded_v1 select g.*,new.id,now() from gone g;
  with gone as (
    delete from public.commerce_shopee_finance_stage_daily_v1 d
    using public.commerce_sales_import_batches ob
    where d.batch_id=ob.id and ob.platform_code='SHOPEE' and ob.status='COMMITTED'
      and ob.snapshot_id is not null and ob.snapshot_id<new.snapshot_id
      and d.sale_date in (select n.sale_date from public.commerce_shopee_finance_stage_daily_v1 n where n.batch_id=new.id)
    returning d.*
  ) insert into public.commerce_shopee_fin_daily_superseded_v1 select g.*,new.id,now() from gone g;
  delete from public.commerce_shopee_full_daily_v1 d
    using public.commerce_sales_import_batches ob
    where d.batch_id=ob.id and ob.platform_code='SHOPEE' and ob.status='COMMITTED'
      and ob.snapshot_id is not null and ob.snapshot_id<new.snapshot_id
      and d.sale_date in (select n.sale_date from public.commerce_shopee_sales_sku_daily_v1 n where n.batch_id=new.id);
  delete from public.commerce_shopee_order_extras_daily_v1 d
    using public.commerce_sales_import_batches ob
    where d.batch_id=ob.id and ob.platform_code='SHOPEE' and ob.status='COMMITTED'
      and ob.snapshot_id is not null and ob.snapshot_id<new.snapshot_id
      and d.sale_date in (select n.sale_date from public.commerce_shopee_sales_sku_daily_v1 n where n.batch_id=new.id);
  return new;
end $fn$;
