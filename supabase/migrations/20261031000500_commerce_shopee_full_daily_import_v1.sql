-- Importação Shopee passa a guardar o faturamento Full por dia e SKU.
create table if not exists public.commerce_shopee_full_daily_v1 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,
  sku_norm text not null,
  units integer not null default 0,
  product_revenue numeric(14,2) not null default 0,
  primary key (batch_id, sale_date, sku_norm)
);
alter table public.commerce_shopee_full_daily_v1 enable row level security;
revoke all on public.commerce_shopee_full_daily_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_shopee_full_daily_v1 to service_role;

create or replace function public.commerce_append_shopee_full_daily_v1(p_batch_id bigint, p_rows jsonb)
returns integer language plpgsql security invoker set search_path=public as $fn$
declare v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>100
  then raise exception 'full_daily_rows deve conter 1 a 100 linhas.'; end if;
  if not exists(select 1 from public.commerce_sales_import_batches b
    where b.id=p_batch_id and b.platform_code='SHOPEE' and b.status in ('UPLOADED','STAGED'))
  then raise exception 'Lote de vendas Shopee inválido ou fechado.'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where
    (r->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    or nullif(public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),'') is null
    or coalesce((r->>'units')::integer,-1)<0 or (r->>'product_revenue') is null)
  then raise exception 'Dados Full inválidos.'; end if;
  insert into public.commerce_shopee_full_daily_v1(batch_id,sale_date,sku_norm,units,product_revenue)
  select p_batch_id,(r->>'sale_date')::date,public.commerce_nisti_sku_norm_v1(r->>'sku_norm'),
    (r->>'units')::integer,(r->>'product_revenue')::numeric
  from jsonb_array_elements(p_rows) r
  on conflict(batch_id,sale_date,sku_norm) do update set units=excluded.units,product_revenue=excluded.product_revenue;
  get diagnostics v_count=row_count;
  return v_count;
end $fn$;
revoke all on function public.commerce_append_shopee_full_daily_v1(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_append_shopee_full_daily_v1(bigint,jsonb) to service_role;

-- Lote novo também substitui o Full dos mesmos dias de snapshots mais antigos.
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

-- Divisão do faturamento: até out/2026 vem da tabela mensal carregada à mão; depois, dos dias importados.
create or replace function public.commerce_dashboard_shipping_split_v1(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path=public as $$
  with last_day as (select max(sale_date) d from public.commerce_shopee_sales_sku_daily_v1),
  full_src as (
    select f.sale_month ms, f.units, f.product_revenue from public.commerce_shopee_full_monthly_v1 f where f.sale_month<='2026-10-01'
    union all
    select date_trunc('month',f.sale_date)::date, f.units, f.product_revenue
    from public.commerce_shopee_full_daily_v1 f join public.commerce_sales_import_batches b on b.id=f.batch_id and b.status='COMMITTED'
    where f.sale_date>='2026-11-01'
  ),
  months as (
    select m::date as ms from generate_series(date_trunc('month',p_start)::date, date_trunc('month',p_end)::date, interval '1 month') m
    where m::date>=p_start
      and p_end>=least((m::date+interval '1 month - 1 day')::date,(select d from last_day))
      and exists (select 1 from full_src f where f.ms=m::date)
  ),
  tot as (select coalesce(sum(s.product_revenue),0) rev, coalesce(sum(s.units),0) units
          from public.commerce_shopee_sales_sku_daily_v1 s join months mo on date_trunc('month',s.sale_date)::date=mo.ms),
  fl as (select coalesce(sum(f.product_revenue),0) rev, coalesce(sum(f.units),0) units
         from full_src f join months mo on f.ms=mo.ms)
  select jsonb_build_object(
    'months',(select coalesce(jsonb_agg(ms order by ms),'[]') from months),
    'total_revenue',(select rev from tot),'full_revenue',(select rev from fl),
    'own_revenue',greatest((select rev from tot)-(select rev from fl),0),
    'total_units',(select units from tot),'full_units',(select units from fl));
$$;
