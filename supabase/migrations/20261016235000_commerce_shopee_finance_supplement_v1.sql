-- Non-destructive supplement: financial amounts extracted from the official
-- Shopee sales workbook. Existing sales snapshots, listings and Scanner rows
-- are never changed. No buyer identifiers or order IDs are stored here.
create table if not exists public.commerce_shopee_finance_imports_v1(
  id bigint generated always as identity primary key,
  source_sha256 text not null unique check(source_sha256 ~ '^[0-9a-f]{64}$'),
  source_filename text not null check(length(source_filename) between 1 and 250),
  imported_by text,
  status text not null default 'UPLOADING' check(status in ('UPLOADING','APPLIED')),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);
create table if not exists public.commerce_shopee_finance_months_v1(
  import_id bigint not null references public.commerce_shopee_finance_imports_v1(id),
  month_start date not null,
  orders integer not null check(orders>=0),
  units integer not null check(units>=0),
  product_revenue numeric(18,2) not null check(product_revenue>=0),
  seller_discount numeric(18,2) not null,
  commission_net numeric(18,2) not null,
  service_net numeric(18,2) not null,
  transaction_fee numeric(18,2) not null,
  fee_orders integer not null check(fee_orders>=0),
  single_sku_fee_orders integer not null check(single_sku_fee_orders>=0),
  unallocated_orders integer not null check(unallocated_orders>=0),
  unallocated_units integer not null check(unallocated_units>=0),
  unallocated_revenue numeric(18,2) not null check(unallocated_revenue>=0),
  primary key(import_id,month_start),
  check(month_start=date_trunc('month',month_start)::date),
  check(fee_orders<=orders and single_sku_fee_orders<=fee_orders)
);
create table if not exists public.commerce_shopee_finance_daily_v1(
  import_id bigint not null references public.commerce_shopee_finance_imports_v1(id),
  sale_date date not null,
  sku_norm text not null check(length(sku_norm) between 1 and 160),
  orders integer not null check(orders>=1),
  units integer not null check(units>=1),
  product_revenue numeric(18,2) not null check(product_revenue>=0),
  seller_discount numeric(18,2) not null,
  commission_net numeric(18,2) not null,
  service_net numeric(18,2) not null,
  transaction_fee numeric(18,2) not null,
  primary key(import_id,sale_date,sku_norm)
);
create index if not exists commerce_shopee_finance_daily_date_idx
  on public.commerce_shopee_finance_daily_v1(sale_date,sku_norm);

alter table public.commerce_shopee_finance_imports_v1 enable row level security;
alter table public.commerce_shopee_finance_months_v1 enable row level security;
alter table public.commerce_shopee_finance_daily_v1 enable row level security;
revoke all on public.commerce_shopee_finance_imports_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_months_v1 from public,anon,authenticated;
revoke all on public.commerce_shopee_finance_daily_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_finance_imports_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_months_v1 to service_role;
grant select,insert,update on public.commerce_shopee_finance_daily_v1 to service_role;
grant usage on sequence public.commerce_shopee_finance_imports_v1_id_seq to service_role;

create or replace function public.commerce_shopee_finance_begin_v1(
  p_sha256 text,p_filename text,p_actor text
) returns jsonb language plpgsql security invoker set search_path=public as $f$
declare v_row public.commerce_shopee_finance_imports_v1%rowtype;
begin
  if p_sha256 !~ '^[0-9a-f]{64}$' or length(btrim(coalesce(p_filename,''))) not between 1 and 250
     then raise exception 'Arquivo financeiro inválido.';end if;
  insert into public.commerce_shopee_finance_imports_v1(
    source_sha256,source_filename,imported_by
  ) values(p_sha256,btrim(p_filename),left(btrim(coalesce(p_actor,'')),120))
  on conflict(source_sha256) do nothing;
  select * into v_row from public.commerce_shopee_finance_imports_v1
  where source_sha256=p_sha256;
  return jsonb_build_object('import_id',v_row.id,'status',v_row.status);
end $f$;

create or replace function public.commerce_shopee_finance_append_month_v1(
  p_import_id bigint,p_rows jsonb
) returns integer language plpgsql security invoker set search_path=public as $f$
declare v_status text;v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 15 then
    raise exception 'Envie entre 1 e 15 resumos financeiros.';end if;
  select status into v_status from public.commerce_shopee_finance_imports_v1
    where id=p_import_id for update;
  if v_status is distinct from 'UPLOADING' then raise exception 'Importação financeira fechada ou inexistente.';end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x
    where (x->>'month_start') !~ '^20[0-9]{2}-[0-9]{2}-01$'
      or (x->>'units') !~ '^[0-9]{1,9}$'
      or (x->>'orders') !~ '^[0-9]{1,9}$'
      or (x->>'product_revenue') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
      or (x->>'fee_orders') !~ '^[0-9]{1,9}$'
      or (x->>'single_sku_fee_orders') !~ '^[0-9]{1,9}$'
      or (x->>'unallocated_orders') !~ '^[0-9]{1,9}$'
      or (x->>'unallocated_units') !~ '^[0-9]{1,9}$'
      or (x->>'unallocated_revenue') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
      or exists(
        select 1 from (values ('seller_discount'),('commission_net'),
          ('service_net'),('transaction_fee')) v(k)
        where (x->>v.k) !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
      )
  ) then raise exception 'Dados financeiros mensais inválidos.';end if;
  insert into public.commerce_shopee_finance_months_v1(
    import_id,month_start,orders,units,product_revenue,seller_discount,
    commission_net,service_net,transaction_fee,fee_orders,single_sku_fee_orders,
    unallocated_orders,unallocated_units,unallocated_revenue
  )
  select p_import_id,(x->>'month_start')::date,
    (x->>'orders')::int,(x->>'units')::int,(x->>'product_revenue')::numeric,
    (x->>'seller_discount')::numeric,(x->>'commission_net')::numeric,
    (x->>'service_net')::numeric,(x->>'transaction_fee')::numeric,
    (x->>'fee_orders')::int,(x->>'single_sku_fee_orders')::int,
    (x->>'unallocated_orders')::int,(x->>'unallocated_units')::int,
    (x->>'unallocated_revenue')::numeric
  from jsonb_array_elements(p_rows) x
  on conflict(import_id,month_start) do update set
    orders=excluded.orders,units=excluded.units,
    product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
    commission_net=excluded.commission_net,service_net=excluded.service_net,
    transaction_fee=excluded.transaction_fee,fee_orders=excluded.fee_orders,
    single_sku_fee_orders=excluded.single_sku_fee_orders,
    unallocated_orders=excluded.unallocated_orders,unallocated_units=excluded.unallocated_units,
    unallocated_revenue=excluded.unallocated_revenue;
  get diagnostics v_count=row_count;
  return v_count;
end $f$;

create or replace function public.commerce_shopee_finance_append_daily_v1(
  p_import_id bigint,p_rows jsonb
) returns integer language plpgsql security invoker set search_path=public as $f$
declare v_status text;v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Envie entre 1 e 100 totais diários.';end if;
  select status into v_status from public.commerce_shopee_finance_imports_v1
    where id=p_import_id for update;
  if v_status is distinct from 'UPLOADING' then raise exception 'Importação financeira fechada ou inexistente.';end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x
    where (x->>'sale_date') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      or nullif(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),'') is null
      or length(public.commerce_nisti_sku_norm_v1(x->>'sku_norm'))>160
      or (x->>'units') !~ '^[1-9][0-9]{0,8}$'
      or (x->>'orders') !~ '^[1-9][0-9]{0,8}$'
      or (x->>'product_revenue') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
      or exists(
        select 1 from (values ('seller_discount'),('commission_net'),
          ('service_net'),('transaction_fee')) v(k)
        where (x->>v.k) !~ '^-?[0-9]{1,12}(\.[0-9]{1,2})?$'
      )
  ) then raise exception 'Dados financeiros diários inválidos.';end if;
  insert into public.commerce_shopee_finance_daily_v1(
    import_id,sale_date,sku_norm,orders,units,product_revenue,
    seller_discount,commission_net,service_net,transaction_fee
  )
  select p_import_id,(x->>'sale_date')::date,
    public.commerce_nisti_sku_norm_v1(x->>'sku_norm'),
    (x->>'orders')::int,(x->>'units')::int,(x->>'product_revenue')::numeric,
    (x->>'seller_discount')::numeric,(x->>'commission_net')::numeric,
    (x->>'service_net')::numeric,(x->>'transaction_fee')::numeric
  from jsonb_array_elements(p_rows) x
  on conflict(import_id,sale_date,sku_norm) do update set
    orders=excluded.orders,units=excluded.units,
    product_revenue=excluded.product_revenue,seller_discount=excluded.seller_discount,
    commission_net=excluded.commission_net,service_net=excluded.service_net,
    transaction_fee=excluded.transaction_fee;
  get diagnostics v_count=row_count;
  return v_count;
end $f$;

-- Financial-only apply. Exact month totals must reconcile with the already
-- imported sales snapshot. Never replace monthly sales to add fee columns.
create or replace function public.commerce_shopee_finance_apply_v1(
  p_import_id bigint
) returns jsonb language plpgsql security invoker set search_path=public as $f$
declare v_status text;v_total int;v_covered int;
begin
  select status into v_status from public.commerce_shopee_finance_imports_v1
    where id=p_import_id for update;
  if v_status='APPLIED' then return jsonb_build_object(
    'status','APPLIED','already_applied',true,'import_id',p_import_id);end if;
  if v_status is distinct from 'UPLOADING' then
    raise exception 'Importação financeira não encontrada.';end if;
  select count(*) into v_total from public.commerce_shopee_finance_months_v1
    where import_id=p_import_id;
  if v_total=0 then raise exception 'Nenhum mês financeiro recebido.';end if;
  if exists(
    select 1 from public.commerce_shopee_finance_months_v1 f
    left join public.commerce_sales_snapshots sn on sn.is_current
    left join public.commerce_sales_summary_rows s on s.snapshot_id=sn.id
      and s.platform_code='SHOPEE' and s.period_start=f.month_start
    where f.import_id=p_import_id and (
      s.period_start is null or s.units<>f.units
      or round(s.product_revenue,2)<>f.product_revenue
      or s.net_orders<>f.orders
    )
  ) then raise exception
    'Totais do Excel não coincidem com as vendas atuais. Não foram alteradas vendas nem taxas.';
  end if;
  -- No duplicated fees: the detailed finance dataset must fit within
  -- all verified single-line orders for its corresponding month.
  if exists(
    select 1 from public.commerce_shopee_finance_months_v1 m
    left join lateral (
      select coalesce(sum(d.orders),0) orders,coalesce(sum(d.units),0) units,
             coalesce(sum(d.product_revenue),0)::numeric(18,2) revenue
      from public.commerce_shopee_finance_daily_v1 d
      where d.import_id=m.import_id
        and date_trunc('month',d.sale_date)::date=m.month_start
    ) t on true
    where m.import_id=p_import_id and (
      t.orders<>m.single_sku_fee_orders or t.units>m.units
      or t.revenue>m.product_revenue
      or m.fee_orders+m.unallocated_orders<>m.orders
    )
  ) then raise exception 'Totais financeiros por SKU divergentes. Nenhuma alteração aplicada.';end if;
  update public.commerce_shopee_finance_imports_v1 set
    status='APPLIED',applied_at=now() where id=p_import_id;
  select count(*) into v_covered from public.commerce_shopee_finance_daily_v1
    where import_id=p_import_id;
  return jsonb_build_object('status','APPLIED','import_id',p_import_id,
    'months',v_total,'daily_skus',v_covered,'sales_modified',false);
end $f$;

-- This view becomes empty for a month automatically if the original
-- monthly sales totals change after a later import. No stale fee display.
create or replace view public.commerce_shopee_finance_valid_months_v1
with (security_invoker=true) as
select distinct on (m.month_start) m.*,b.applied_at,b.source_filename
from public.commerce_shopee_finance_months_v1 m
join public.commerce_shopee_finance_imports_v1 b
  on b.id=m.import_id and b.status='APPLIED'
join public.commerce_sales_snapshots sn on sn.is_current
join public.commerce_sales_summary_rows s
  on s.snapshot_id=sn.id and s.platform_code='SHOPEE'
  and s.period_start=m.month_start and s.units=m.units
  and round(s.product_revenue,2)=m.product_revenue
  and s.net_orders=m.orders
order by m.month_start,b.applied_at desc,m.import_id desc;
revoke all on public.commerce_shopee_finance_valid_months_v1 from public,anon,authenticated;
grant select on public.commerce_shopee_finance_valid_months_v1 to service_role;

create or replace function public.commerce_shopee_listing_finance_v1(
  p_external_listing_id text,p_period_start date,p_period_end date
) returns jsonb language sql stable security invoker set search_path=public as $f$
with chosen as(
  select l.id from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and l.external_listing_id=p_external_listing_id
  limit 1
), eligible as (
  select d.* from public.commerce_shopee_finance_daily_v1 d
  join public.commerce_shopee_finance_valid_months_v1 month
    on month.import_id=d.import_id
    and month.month_start=date_trunc('month',d.sale_date)::date
  join public.commerce_shopee_sku_owner_reviewed_v1 owner
    on owner.source_sku_norm=d.sku_norm
  join chosen l on l.id=owner.listing_id
  where d.sale_date between p_period_start and p_period_end
), summarized as (
  select count(*)::int sku_days,coalesce(sum(orders),0)::bigint fee_orders,
    coalesce(sum(units),0)::bigint units,
    coalesce(sum(product_revenue),0)::numeric(18,2) product_revenue,
    coalesce(sum(seller_discount),0)::numeric(18,2) seller_discount,
    coalesce(sum(commission_net),0)::numeric(18,2) commission_net,
    coalesce(sum(service_net),0)::numeric(18,2) service_net,
    coalesce(sum(transaction_fee),0)::numeric(18,2) transaction_fee
  from eligible
), valid_months as (
  select count(*)::int matched_months,coalesce(sum(orders),0)::bigint total_orders,
    coalesce(sum(fee_orders),0)::bigint verified_orders,
    coalesce(sum(unallocated_orders),0)::bigint unallocated_orders
  from public.commerce_shopee_finance_valid_months_v1
  where month_start between date_trunc('month',p_period_start)::date
    and date_trunc('month',p_period_end)::date
)
select jsonb_build_object(
  'available',(select sku_days>0 from summarized),
  'covered_months',(select matched_months from valid_months),
  'fee_orders',(select fee_orders from summarized),
  'units',(select units from summarized),
  'product_revenue',(select product_revenue from summarized),
  'seller_discount',(select seller_discount from summarized),
  'commission_net',(select commission_net from summarized),
  'service_net',(select service_net from summarized),
  'transaction_fee',(select transaction_fee from summarized),
  'subtotal_after_identified_fees',
    (select product_revenue-commission_net-service_net-transaction_fee from summarized),
  'period_start',p_period_start,'period_end',p_period_end,
  'source_kind','SINGLE_LINE_SHOPEE_ORDERS',
  'complete',false,
  'note','Taxas somente de pedidos com uma linha e SKU ligado de modo único. Outros pedidos e custos de frete não incluídos.'
);
$f$;

revoke all on function public.commerce_shopee_finance_begin_v1(text,text,text)
  from public,anon,authenticated;
revoke all on function public.commerce_shopee_finance_append_month_v1(bigint,jsonb)
  from public,anon,authenticated;
revoke all on function public.commerce_shopee_finance_append_daily_v1(bigint,jsonb)
  from public,anon,authenticated;
revoke all on function public.commerce_shopee_finance_apply_v1(bigint)
  from public,anon,authenticated;
revoke all on function public.commerce_shopee_listing_finance_v1(text,date,date)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_finance_begin_v1(text,text,text) to service_role;
grant execute on function public.commerce_shopee_finance_append_month_v1(bigint,jsonb) to service_role;
grant execute on function public.commerce_shopee_finance_append_daily_v1(bigint,jsonb) to service_role;
grant execute on function public.commerce_shopee_finance_apply_v1(bigint) to service_role;
grant execute on function public.commerce_shopee_listing_finance_v1(text,date,date) to service_role;
