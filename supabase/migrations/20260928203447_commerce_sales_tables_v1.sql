create table if not exists public.commerce_sales_snapshots (
  id bigserial primary key,
  source_name text not null,
  source_ref text,
  data_through date,
  row_count integer not null default 0 check (row_count >= 0),
  summary_row_count integer not null default 0 check (summary_row_count >= 0),
  is_current boolean not null default false,
  imported_at timestamptz not null default now(),
  created_by text
);

create unique index if not exists commerce_sales_snapshots_one_current_idx
  on public.commerce_sales_snapshots ((is_current))
  where is_current=true;

create table if not exists public.commerce_sales_rows (
  snapshot_id bigint not null references public.commerce_sales_snapshots(id) on delete cascade,
  source_row_number integer not null check (source_row_number > 0),
  platform_code text not null check (platform_code in ('SHOPEE','ML_NOVO','ML_ANTIGO')),
  period_key text not null,
  period_start date not null,
  period_end date not null,
  sku_primary text,
  sku text not null,
  sku_norm text not null,
  product_name text,
  variation text,
  units integer not null default 0 check (units >= 0),
  orders_with_item integer not null default 0 check (orders_with_item >= 0),
  product_revenue numeric(14,2) not null default 0,
  primary key (snapshot_id, source_row_number)
);

create index if not exists commerce_sales_rows_period_idx
  on public.commerce_sales_rows (snapshot_id, platform_code, period_start);

create index if not exists commerce_sales_rows_sku_idx
  on public.commerce_sales_rows (snapshot_id, sku_norm, period_start);

create index if not exists commerce_sales_rows_listing_idx
  on public.commerce_sales_rows (snapshot_id, platform_code, sku_primary);

create table if not exists public.commerce_sales_summary_rows (
  snapshot_id bigint not null references public.commerce_sales_snapshots(id) on delete cascade,
  platform_code text not null check (platform_code in ('SHOPEE','ML_NOVO','ML_ANTIGO')),
  period_key text not null,
  period_start date not null,
  period_end date not null,
  net_orders integer not null default 0 check (net_orders >= 0),
  units integer not null default 0 check (units >= 0),
  product_revenue numeric(14,2) not null default 0,
  listings_with_sales integer,
  skus_with_sales integer,
  primary key (snapshot_id, platform_code, period_key)
);

create index if not exists commerce_sales_summary_period_idx
  on public.commerce_sales_summary_rows (snapshot_id, platform_code, period_start);

alter table public.commerce_sales_snapshots enable row level security;
alter table public.commerce_sales_rows enable row level security;
alter table public.commerce_sales_summary_rows enable row level security;

revoke all on public.commerce_sales_snapshots from public,anon,authenticated;
revoke all on public.commerce_sales_rows from public,anon,authenticated;
revoke all on public.commerce_sales_summary_rows from public,anon,authenticated;

grant select,insert,update,delete on public.commerce_sales_snapshots to service_role;
grant select,insert,update,delete on public.commerce_sales_rows to service_role;
grant select,insert,update,delete on public.commerce_sales_summary_rows to service_role;
grant usage,select on sequence public.commerce_sales_snapshots_id_seq to service_role;
