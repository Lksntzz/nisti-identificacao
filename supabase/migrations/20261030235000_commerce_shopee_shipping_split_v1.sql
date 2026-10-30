-- Faturamento Shopee por tipo de envio (Full x envio próprio), por meses inteiros dentro do período.
create table if not exists public.commerce_shopee_full_monthly_v1 (
  sale_month date not null,
  sku_norm text not null,
  units integer not null default 0,
  product_revenue numeric(14,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (sale_month, sku_norm)
);
alter table public.commerce_shopee_full_monthly_v1 enable row level security;
revoke all on public.commerce_shopee_full_monthly_v1 from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_shopee_full_monthly_v1 to service_role;

create or replace function public.commerce_dashboard_shipping_split_v1(p_start date, p_end date)
returns jsonb language sql stable security invoker set search_path=public as $$
  with last_day as (select max(sale_date) d from public.commerce_shopee_sales_sku_daily_v1),
  months as (
    select m::date as ms from generate_series(date_trunc('month',p_start)::date, date_trunc('month',p_end)::date, interval '1 month') m
    where m::date>=p_start
      and p_end>=least((m::date+interval '1 month - 1 day')::date,(select d from last_day))
      and exists (select 1 from public.commerce_shopee_full_monthly_v1 f where f.sale_month=m::date)
  ),
  tot as (select coalesce(sum(s.product_revenue),0) rev, coalesce(sum(s.units),0) units
          from public.commerce_shopee_sales_sku_daily_v1 s join months mo on date_trunc('month',s.sale_date)::date=mo.ms),
  fl as (select coalesce(sum(f.product_revenue),0) rev, coalesce(sum(f.units),0) units
         from public.commerce_shopee_full_monthly_v1 f join months mo on f.sale_month=mo.ms)
  select jsonb_build_object(
    'months',(select coalesce(jsonb_agg(ms order by ms),'[]') from months),
    'total_revenue',(select rev from tot),'full_revenue',(select rev from fl),
    'own_revenue',greatest((select rev from tot)-(select rev from fl),0),
    'total_units',(select units from tot),'full_units',(select units from fl));
$$;
revoke all on function public.commerce_dashboard_shipping_split_v1(date,date) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_shipping_split_v1(date,date) to service_role;
