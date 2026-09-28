
create table if not exists public.commerce_sales_import_batches (
  id bigserial primary key,
  platform_code text not null check (platform_code in ('SHOPEE','ML_NOVO','ML_ANTIGO')),
  source_filename text not null,
  source_sha256 text,
  status text not null default 'UPLOADED' check (status in ('UPLOADED','STAGED','COMMITTED','FAILED')),
  data_through date,
  staged_row_count integer not null default 0 check (staged_row_count >= 0),
  staged_summary_count integer not null default 0 check (staged_summary_count >= 0),
  snapshot_id bigint references public.commerce_sales_snapshots(id) on delete set null,
  created_by text,
  created_at timestamptz not null default now(),
  committed_at timestamptz
);

create table if not exists public.commerce_sales_import_stage_rows (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  source_row_number integer not null check (source_row_number > 0),
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
  primary key (batch_id, source_row_number)
);

create table if not exists public.commerce_sales_import_stage_summary (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  period_key text not null,
  period_start date not null,
  period_end date not null,
  net_orders integer not null default 0 check (net_orders >= 0),
  units integer not null default 0 check (units >= 0),
  product_revenue numeric(14,2) not null default 0,
  listings_with_sales integer,
  skus_with_sales integer,
  primary key (batch_id, period_key)
);

create index if not exists commerce_sales_import_batches_created_idx
  on public.commerce_sales_import_batches (created_at desc);

create index if not exists commerce_sales_import_stage_rows_period_idx
  on public.commerce_sales_import_stage_rows (batch_id, period_start, sku_norm);

alter table public.commerce_sales_import_batches enable row level security;
alter table public.commerce_sales_import_stage_rows enable row level security;
alter table public.commerce_sales_import_stage_summary enable row level security;

revoke all on public.commerce_sales_import_batches from public,anon,authenticated;
revoke all on public.commerce_sales_import_stage_rows from public,anon,authenticated;
revoke all on public.commerce_sales_import_stage_summary from public,anon,authenticated;
grant select,insert,update,delete on public.commerce_sales_import_batches to service_role;
grant select,insert,update,delete on public.commerce_sales_import_stage_rows to service_role;
grant select,insert,update,delete on public.commerce_sales_import_stage_summary to service_role;
grant usage,select on sequence public.commerce_sales_import_batches_id_seq to service_role;

create or replace function public.commerce_create_sales_import_v1(
  p_platform_code text,
  p_source_filename text,
  p_source_sha256 text default null,
  p_created_by text default null
)
returns bigint
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_platform text := upper(btrim(coalesce(p_platform_code,'')));
  v_id bigint;
begin
  if v_platform not in ('SHOPEE','ML_NOVO','ML_ANTIGO') then
    raise exception 'sales_import_platform_invalid' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_source_filename,'')),'') is null then
    raise exception 'sales_import_filename_required' using errcode='22023';
  end if;

  insert into public.commerce_sales_import_batches(
    platform_code,source_filename,source_sha256,created_by
  ) values(
    v_platform,btrim(p_source_filename),nullif(btrim(coalesce(p_source_sha256,'')),''),
    nullif(btrim(coalesce(p_created_by,'')),'')
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.commerce_append_sales_import_rows_v1(
  p_batch_id bigint,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_inserted integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'sales_import_rows_array_required' using errcode='22023';
  end if;

  insert into public.commerce_sales_import_stage_rows(
    batch_id,source_row_number,period_key,period_start,period_end,
    sku_primary,sku,sku_norm,product_name,variation,units,orders_with_item,product_revenue
  )
  select
    p_batch_id,
    (x->>'source_row_number')::integer,
    btrim(x->>'period_key'),
    (x->>'period_start')::date,
    (x->>'period_end')::date,
    nullif(btrim(coalesce(x->>'sku_primary','')),''),
    btrim(x->>'sku'),
    btrim(x->>'sku_norm'),
    nullif(btrim(coalesce(x->>'product_name','')),''),
    nullif(btrim(coalesce(x->>'variation','')),''),
    greatest(coalesce((x->>'units')::integer,0),0),
    greatest(coalesce((x->>'orders_with_item')::integer,0),0),
    coalesce((x->>'product_revenue')::numeric,0)
  from jsonb_array_elements(p_rows) x
  on conflict(batch_id,source_row_number) do update set
    period_key=excluded.period_key,
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    sku_primary=excluded.sku_primary,
    sku=excluded.sku,
    sku_norm=excluded.sku_norm,
    product_name=excluded.product_name,
    variation=excluded.variation,
    units=excluded.units,
    orders_with_item=excluded.orders_with_item,
    product_revenue=excluded.product_revenue;

  get diagnostics v_inserted = row_count;

  update public.commerce_sales_import_batches b
  set
    status='STAGED',
    staged_row_count=(select count(*) from public.commerce_sales_import_stage_rows r where r.batch_id=b.id),
    data_through=(select max(period_end) from public.commerce_sales_import_stage_rows r where r.batch_id=b.id)
  where b.id=p_batch_id;

  return v_inserted;
end;
$$;

create or replace function public.commerce_append_sales_import_summary_v1(
  p_batch_id bigint,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_inserted integer := 0;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'sales_import_summary_array_required' using errcode='22023';
  end if;

  insert into public.commerce_sales_import_stage_summary(
    batch_id,period_key,period_start,period_end,net_orders,units,product_revenue,
    listings_with_sales,skus_with_sales
  )
  select
    p_batch_id,
    btrim(x->>'period_key'),
    (x->>'period_start')::date,
    (x->>'period_end')::date,
    greatest(coalesce((x->>'net_orders')::integer,0),0),
    greatest(coalesce((x->>'units')::integer,0),0),
    coalesce((x->>'product_revenue')::numeric,0),
    case when x ? 'listings_with_sales' then (x->>'listings_with_sales')::integer else null end,
    case when x ? 'skus_with_sales' then (x->>'skus_with_sales')::integer else null end
  from jsonb_array_elements(p_rows) x
  on conflict(batch_id,period_key) do update set
    period_start=excluded.period_start,
    period_end=excluded.period_end,
    net_orders=excluded.net_orders,
    units=excluded.units,
    product_revenue=excluded.product_revenue,
    listings_with_sales=excluded.listings_with_sales,
    skus_with_sales=excluded.skus_with_sales;

  get diagnostics v_inserted = row_count;

  update public.commerce_sales_import_batches b
  set
    status='STAGED',
    staged_summary_count=(select count(*) from public.commerce_sales_import_stage_summary r where r.batch_id=b.id)
  where b.id=p_batch_id;

  return v_inserted;
end;
$$;

create or replace function public.commerce_commit_sales_import_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_batch public.commerce_sales_import_batches%rowtype;
  v_old_snapshot bigint;
  v_new_snapshot bigint;
  v_rows integer;
  v_summaries integer;
begin
  select * into v_batch
  from public.commerce_sales_import_batches
  where id=p_batch_id
  for update;

  if not found then
    raise exception 'sales_import_batch_not_found' using errcode='22023';
  end if;
  if v_batch.status='COMMITTED' and v_batch.snapshot_id is not null then
    return jsonb_build_object(
      'status','COMMITTED','batch_id',v_batch.id,'snapshot_id',v_batch.snapshot_id,
      'already_committed',true
    );
  end if;

  select id into v_old_snapshot
  from public.commerce_sales_snapshots
  where is_current=true
  order by id desc
  limit 1;

  if not exists(select 1 from public.commerce_sales_import_stage_rows where batch_id=p_batch_id) then
    raise exception 'sales_import_no_rows' using errcode='22023';
  end if;

  insert into public.commerce_sales_snapshots(
    source_name,source_ref,data_through,row_count,summary_row_count,is_current,created_by
  ) values(
    'IMPORTAÇÃO COMERCIAL',
    'sales-import:'||p_batch_id::text,
    v_batch.data_through,
    0,0,false,
    v_batch.created_by
  )
  returning id into v_new_snapshot;

  with imported_periods as (
    select distinct period_key
    from public.commerce_sales_import_stage_rows
    where batch_id=p_batch_id
  ),
  combined as (
    select
      r.platform_code,r.period_key,r.period_start,r.period_end,r.sku_primary,r.sku,r.sku_norm,
      r.product_name,r.variation,r.units,r.orders_with_item,r.product_revenue,
      0 as source_order
    from public.commerce_sales_rows r
    where r.snapshot_id=v_old_snapshot
      and not (
        r.platform_code=v_batch.platform_code
        and exists(select 1 from imported_periods p where p.period_key=r.period_key)
      )

    union all

    select
      v_batch.platform_code,r.period_key,r.period_start,r.period_end,r.sku_primary,r.sku,r.sku_norm,
      r.product_name,r.variation,r.units,r.orders_with_item,r.product_revenue,
      1 as source_order
    from public.commerce_sales_import_stage_rows r
    where r.batch_id=p_batch_id
  ),
  numbered as (
    select row_number() over(
      order by platform_code,period_start,sku_norm,coalesce(sku_primary,''),sku,source_order
    )::integer as source_row_number,*
    from combined
  )
  insert into public.commerce_sales_rows(
    snapshot_id,source_row_number,platform_code,period_key,period_start,period_end,
    sku_primary,sku,sku_norm,product_name,variation,units,orders_with_item,product_revenue
  )
  select
    v_new_snapshot,source_row_number,platform_code,period_key,period_start,period_end,
    sku_primary,sku,sku_norm,product_name,variation,units,orders_with_item,product_revenue
  from numbered;

  with imported_periods as (
    select distinct period_key
    from public.commerce_sales_import_stage_rows
    where batch_id=p_batch_id
  )
  insert into public.commerce_sales_summary_rows(
    snapshot_id,platform_code,period_key,period_start,period_end,net_orders,units,
    product_revenue,listings_with_sales,skus_with_sales
  )
  select
    v_new_snapshot,s.platform_code,s.period_key,s.period_start,s.period_end,s.net_orders,s.units,
    s.product_revenue,s.listings_with_sales,s.skus_with_sales
  from public.commerce_sales_summary_rows s
  where s.snapshot_id=v_old_snapshot
    and not (
      s.platform_code=v_batch.platform_code
      and exists(select 1 from imported_periods p where p.period_key=s.period_key)
    )

  union all

  select
    v_new_snapshot,v_batch.platform_code,s.period_key,s.period_start,s.period_end,s.net_orders,s.units,
    s.product_revenue,s.listings_with_sales,s.skus_with_sales
  from public.commerce_sales_import_stage_summary s
  where s.batch_id=p_batch_id;

  -- Fallback de resumo para períodos que não receberam summary explícito.
  insert into public.commerce_sales_summary_rows(
    snapshot_id,platform_code,period_key,period_start,period_end,net_orders,units,
    product_revenue,listings_with_sales,skus_with_sales
  )
  select
    v_new_snapshot,
    v_batch.platform_code,
    r.period_key,
    min(r.period_start),
    max(r.period_end),
    sum(r.orders_with_item)::integer,
    sum(r.units)::integer,
    round(sum(r.product_revenue),2),
    count(*)::integer,
    count(distinct r.sku_norm)::integer
  from public.commerce_sales_import_stage_rows r
  where r.batch_id=p_batch_id
    and not exists(
      select 1
      from public.commerce_sales_import_stage_summary s
      where s.batch_id=p_batch_id and s.period_key=r.period_key
    )
  group by r.period_key;

  select count(*) into v_rows
  from public.commerce_sales_rows
  where snapshot_id=v_new_snapshot;

  select count(*) into v_summaries
  from public.commerce_sales_summary_rows
  where snapshot_id=v_new_snapshot;

  update public.commerce_sales_snapshots
  set
    row_count=v_rows,
    summary_row_count=v_summaries,
    data_through=(
      select max(period_end)
      from public.commerce_sales_summary_rows
      where snapshot_id=v_new_snapshot
    )
  where id=v_new_snapshot;

  update public.commerce_sales_snapshots
  set is_current=false
  where is_current=true and id<>v_new_snapshot;

  update public.commerce_sales_snapshots
  set is_current=true
  where id=v_new_snapshot;

  update public.commerce_sales_import_batches
  set
    status='COMMITTED',
    snapshot_id=v_new_snapshot,
    committed_at=now()
  where id=p_batch_id;

  return jsonb_build_object(
    'status','COMMITTED',
    'batch_id',p_batch_id,
    'snapshot_id',v_new_snapshot,
    'rows',v_rows,
    'summary_rows',v_summaries,
    'data_through',(select data_through from public.commerce_sales_snapshots where id=v_new_snapshot)
  );
exception when others then
  update public.commerce_sales_import_batches
  set status='FAILED'
  where id=p_batch_id and status<>'COMMITTED';
  raise;
end;
$$;

create or replace function public.commerce_list_sales_imports_v1(
  p_limit integer default 30,
  p_offset integer default 0
)
returns table(
  id bigint,
  platform_code text,
  source_filename text,
  status text,
  data_through date,
  staged_row_count integer,
  staged_summary_count integer,
  snapshot_id bigint,
  created_by text,
  created_at timestamptz,
  committed_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    b.id,b.platform_code,b.source_filename,b.status,b.data_through,b.staged_row_count,
    b.staged_summary_count,b.snapshot_id,b.created_by,b.created_at,b.committed_at,
    count(*) over() as total_count
  from public.commerce_sales_import_batches b
  order by b.id desc
  limit least(greatest(coalesce(p_limit,30),1),100)
  offset greatest(coalesce(p_offset,0),0);
$$;

revoke all on function public.commerce_create_sales_import_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function public.commerce_append_sales_import_rows_v1(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.commerce_append_sales_import_summary_v1(bigint,jsonb) from public,anon,authenticated;
revoke all on function public.commerce_commit_sales_import_v1(bigint) from public,anon,authenticated;
revoke all on function public.commerce_list_sales_imports_v1(integer,integer) from public,anon,authenticated;

grant execute on function public.commerce_create_sales_import_v1(text,text,text,text) to service_role;
grant execute on function public.commerce_append_sales_import_rows_v1(bigint,jsonb) to service_role;
grant execute on function public.commerce_append_sales_import_summary_v1(bigint,jsonb) to service_role;
grant execute on function public.commerce_commit_sales_import_v1(bigint) to service_role;
grant execute on function public.commerce_list_sales_imports_v1(integer,integer) to service_role;
