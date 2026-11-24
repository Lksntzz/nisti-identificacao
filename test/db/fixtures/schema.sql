-- Esquema MÍNIMO e FICTÍCIO para testar a v2 num Postgres local descartável (nunca no banco real).
-- Colunas copiadas do banco de produção (somente leitura do catálogo). Sem dados de negócio.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;

create table public.commerce_sales_snapshots (
  id bigserial primary key, source_name text not null, source_ref text, data_through date,
  row_count integer not null default 0, summary_row_count integer not null default 0,
  is_current boolean not null default false, imported_at timestamptz not null default now(), created_by text);
create table public.commerce_sales_import_batches (
  id bigserial primary key, platform_code text not null, source_filename text not null, source_sha256 text,
  status text not null default 'UPLOADED', data_through date, staged_row_count integer not null default 0,
  staged_summary_count integer not null default 0, snapshot_id bigint, created_by text,
  created_at timestamptz not null default now(), committed_at timestamptz);
create table public.commerce_sales_rows (
  snapshot_id bigint not null references public.commerce_sales_snapshots(id) on delete cascade,
  source_row_number integer not null, platform_code text not null, period_key text not null,
  period_start date not null, period_end date not null, sku_primary text, sku text not null, sku_norm text not null,
  product_name text, variation text, units integer not null default 0, orders_with_item integer not null default 0,
  product_revenue numeric not null default 0, primary key (snapshot_id, source_row_number));
create table public.commerce_sales_summary_rows (
  snapshot_id bigint not null references public.commerce_sales_snapshots(id) on delete cascade,
  platform_code text not null, period_key text not null, period_start date not null, period_end date not null,
  net_orders integer not null default 0, units integer not null default 0, product_revenue numeric not null default 0,
  listings_with_sales integer, skus_with_sales integer, primary key (snapshot_id, platform_code, period_key));
create table public.commerce_sales_import_stage_rows (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  source_row_number integer not null, period_key text not null, period_start date not null, period_end date not null,
  sku_primary text, sku text not null, sku_norm text not null, product_name text, variation text,
  units integer not null default 0, orders_with_item integer not null default 0, product_revenue numeric not null default 0,
  primary key (batch_id, source_row_number));
create table public.commerce_sales_import_stage_summary (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  period_key text not null, period_start date not null, period_end date not null, net_orders integer not null default 0,
  units integer not null default 0, product_revenue numeric not null default 0, listings_with_sales integer,
  skus_with_sales integer, primary key (batch_id, period_key));
create table public.commerce_shopee_sales_sku_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null, sku_norm text not null, units integer not null, orders_with_item integer not null,
  product_revenue numeric not null, primary key (batch_id, sale_date, sku_norm));
create table public.commerce_sales_listing_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null, external_listing_id text not null, sku_norm text not null, units integer not null,
  orders_with_item integer not null, product_revenue numeric(14,2) not null,
  primary key (batch_id, sale_date, external_listing_id, sku_norm));
create table public.commerce_shopee_finance_stage_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null, sku_norm text not null, orders integer not null, units integer not null,
  product_revenue numeric not null, seller_discount numeric not null, commission_net numeric not null,
  service_net numeric not null, transaction_fee numeric not null, primary key (batch_id, sale_date, sku_norm));
create table public.commerce_shopee_finance_stage_month_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  month_start date not null, orders integer not null, units integer not null, product_revenue numeric not null,
  seller_discount numeric not null, commission_net numeric not null, service_net numeric not null,
  transaction_fee numeric not null, fee_orders integer not null, single_sku_fee_orders integer not null,
  unallocated_orders integer not null, unallocated_units integer not null, unallocated_revenue numeric not null,
  primary key (batch_id, month_start));
create table public.commerce_shopee_full_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null, sku_norm text not null, units integer not null default 0,
  product_revenue numeric not null default 0, primary key (batch_id, sale_date, sku_norm));
create table public.commerce_shopee_order_extras_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null, sku_norm text not null, units integer not null default 0, primary key (batch_id, sale_date, sku_norm));
create table public.commerce_shopee_finance_month_v1 (
  month_start date primary key, source_snapshot_id bigint not null, orders integer not null, units integer not null,
  product_revenue numeric not null, seller_discount numeric not null, commission_net numeric not null,
  service_net numeric not null, transaction_fee numeric not null, fee_orders integer not null,
  single_sku_fee_orders integer not null, unallocated_orders integer not null, unallocated_units integer not null,
  unallocated_revenue numeric not null, activated_at timestamptz not null default now());
create table public.commerce_shopee_finance_daily_v1 (
  sale_date date not null, sku_norm text not null, month_start date not null, source_snapshot_id bigint not null,
  orders integer not null, units integer not null, product_revenue numeric not null, seller_discount numeric not null,
  commission_net numeric not null, service_net numeric not null, transaction_fee numeric not null,
  primary key (sale_date, sku_norm));
create table public.commerce_sku_alias_v1 (alias text primary key);
create table public.commerce_shopee_sku_daily_superseded_v1 (
  like public.commerce_shopee_sales_sku_daily_v1, superseded_by_batch bigint not null,
  superseded_at timestamptz not null default now());
create table public.commerce_shopee_fin_daily_superseded_v1 (
  like public.commerce_shopee_finance_stage_daily_v1, superseded_by_batch bigint not null,
  superseded_at timestamptz not null default now());

-- Mesma função de versão de dados do cache (migração 20261105120000): muda só quando um lote vira COMMITTED.
create or replace function public.commerce_data_version_v1() returns text
language sql stable security invoker set search_path to 'public'
as $$
  select md5(
    coalesce((select max(committed_at)::text||':'||count(*) from public.commerce_sales_import_batches where status='COMMITTED'),'')
    ||'|'||(now() at time zone 'America/Sao_Paulo')::date::text
    ||'|'||(select count(*) from public.commerce_sku_alias_v1));
$$;

-- Gatilho real de substituição de dias da Shopee (migração 20261031000500).
create or replace function public.commerce_shopee_supersede_old_days_v1()
returns trigger language plpgsql security invoker set search_path=public as $fn$
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
  return new;
end $fn$;
drop trigger if exists commerce_shopee_supersede_old_days_trg on public.commerce_sales_import_batches;
create trigger commerce_shopee_supersede_old_days_trg
after update of status on public.commerce_sales_import_batches
for each row when (new.status='COMMITTED' and old.status is distinct from 'COMMITTED')
execute function public.commerce_shopee_supersede_old_days_v1();

-- Cache de leituras (mesmo formato do real) e a view de financeiro mensal visível (definição copiada do catálogo).
create table public.commerce_read_cache_v1 (
  cache_key text primary key, data_version text not null, payload jsonb not null,
  computed_at timestamptz not null default now(), compute_ms integer not null default 0);
create view public.commerce_shopee_finance_current_month_v1 as
 SELECT month_start, source_snapshot_id, orders, units, product_revenue, seller_discount, commission_net, service_net,
    transaction_fee, fee_orders, single_sku_fee_orders, unallocated_orders, unallocated_units, unallocated_revenue, activated_at
   FROM commerce_shopee_finance_month_v1 f
  WHERE source_snapshot_id = (( SELECT b.snapshot_id
           FROM commerce_sales_import_batches b
             JOIN commerce_sales_import_stage_rows r ON r.batch_id = b.id
          WHERE b.status = 'COMMITTED'::text AND b.platform_code = 'SHOPEE'::text
            AND date_trunc('month'::text, r.period_start::timestamp with time zone)::date = f.month_start
          ORDER BY b.committed_at DESC NULLS LAST, b.id DESC
         LIMIT 1));
