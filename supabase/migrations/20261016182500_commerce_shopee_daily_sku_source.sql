-- Preserve real dated Shopee sales lines without assigning shared SKUs to the wrong ad.
-- Existing monthly snapshots remain unchanged. A newer completed import supersedes
-- earlier same-day SKU sources; multiple files in the same snapshot are additive.
create table if not exists public.commerce_shopee_sales_sku_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,
  sku_norm text not null check (sku_norm ~ '^[A-Z0-9]{1,160}$'),
  units integer not null check (units >= 0),
  orders_with_item integer not null check (orders_with_item >= 0),
  product_revenue numeric not null check (product_revenue >= 0),
  primary key (batch_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_sku_daily_date_idx
  on public.commerce_shopee_sales_sku_daily_v1(sale_date,sku_norm);
alter table public.commerce_shopee_sales_sku_daily_v1 enable row level security;
revoke all on public.commerce_shopee_sales_sku_daily_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_shopee_sales_sku_daily_v1 to service_role;

create or replace function public.commerce_append_shopee_sku_daily_v1(
  p_batch_id bigint,p_rows jsonb
) returns integer language plpgsql security invoker set search_path=public as $fn$
declare v_status text;v_platform text;v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows)>100
  then raise exception 'Informe entre 1 e 100 vendas diárias por SKU.';end if;

  select status,platform_code into v_status,v_platform
  from public.commerce_sales_import_batches where id=p_batch_id for update;
  if v_platform is distinct from 'SHOPEE' or v_status not in ('UPLOADED','STAGED')
  then raise exception 'Lote Shopee inexistente ou não está aberto para recebimento.';end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
    where (r->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or nullif(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),'') is null
      or length(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'))>160
      or (r->>'units') !~ '^[0-9]{1,8}$'
      or (r->>'orders_with_item') !~ '^[0-9]{1,8}$'
      or (r->>'product_revenue') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$'
  ) then raise exception 'Linha diária Shopee inválida.';end if;
  insert into public.commerce_shopee_sales_sku_daily_v1(
    batch_id,sale_date,sku_norm,units,orders_with_item,product_revenue)
  select p_batch_id,(r->>'sale_date')::date,
    public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),
    (r->>'units')::integer,(r->>'orders_with_item')::integer,
    (r->>'product_revenue')::numeric
  from jsonb_array_elements(p_rows) r
  on conflict(batch_id,sale_date,sku_norm) do update set
    units=excluded.units,orders_with_item=excluded.orders_with_item,
    product_revenue=excluded.product_revenue;
  get diagnostics v_count=row_count;
  return v_count;
end $fn$;
revoke all on function public.commerce_append_shopee_sku_daily_v1(bigint,jsonb)
  from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_sku_daily_v1(bigint,jsonb)
  to service_role;

-- The previous view selected dates only from day-granular summary files.
-- Shopee publishes one monthly summary but retains true sale_date per order.
create or replace view public.commerce_current_sales_listing_daily_v1
with (security_invoker=true)
as
with base_days as (
  select distinct on(b.platform_code,d.sale_date)
    b.platform_code,d.sale_date,b.id as batch_id
  from public.commerce_sales_import_batches b
  join public.commerce_sales_import_stage_summary s
    on s.batch_id=b.id and s.period_start=s.period_end
  join public.commerce_sales_listing_daily_v1 d
    on d.batch_id=b.id and d.sale_date=s.period_start
  where b.status='COMMITTED'
  order by b.platform_code,d.sale_date,b.committed_at desc,b.id desc
), native_rows as (
  select bd.platform_code,d.sale_date,d.external_listing_id,d.sku_norm,
    d.units,d.orders_with_item,d.product_revenue
  from base_days bd join public.commerce_sales_listing_daily_v1 d
    on d.batch_id=bd.batch_id and d.sale_date=bd.sale_date
), sku_source as (
  select d.sale_date,d.sku_norm,d.units,d.orders_with_item,d.product_revenue,
    coalesce(b.snapshot_id,0) snapshot_id
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id
  where b.platform_code='SHOPEE' and b.status='COMMITTED'
), most_recent as (
  select sale_date,max(snapshot_id) snapshot_id from sku_source group by sale_date
), current_sku as (
  select s.sale_date,s.sku_norm,sum(s.units)::integer units,
    sum(s.orders_with_item)::integer orders_with_item,
    round(sum(s.product_revenue),2)::numeric(14,2) product_revenue
  from sku_source s join most_recent v
    on v.sale_date=s.sale_date and v.snapshot_id=s.snapshot_id
  group by s.sale_date,s.sku_norm
), sku_owner as (
  select public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku_norm,
    min(l.external_listing_id) external_listing_id
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED' and nullif(lp.variation_id,'') is not null
    and nullif(public.commerce_nisti_sku_norm_v1(lp.platform_sku),'') is not null
  group by public.commerce_nisti_sku_norm_v1(lp.platform_sku)
  having count(*)=1
), matched_sku as (
  select 'SHOPEE'::text as platform_code,s.sale_date,o.external_listing_id,
    s.sku_norm,s.units,s.orders_with_item,s.product_revenue
  from current_sku s join sku_owner o on o.sku_norm=s.sku_norm
  where not exists(select 1 from native_rows n
    where n.platform_code='SHOPEE' and n.sale_date=s.sale_date)
)
select platform_code,sale_date,external_listing_id,sku_norm,
  units,orders_with_item,product_revenue from native_rows
union all
select platform_code,sale_date,external_listing_id,sku_norm,
  units,orders_with_item,product_revenue from matched_sku;
revoke all on public.commerce_current_sales_listing_daily_v1 from public,anon,authenticated;
grant select on public.commerce_current_sales_listing_daily_v1 to service_role;