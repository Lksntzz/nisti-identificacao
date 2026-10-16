-- Accept valid historical Shopee sales without inventing a current active
-- listing or choosing between duplicate active variation IDs.
-- Approved-but-unlinked is distinct from sale-to-listing reconciliation.
-- Newly imported units, changed revenue/period, or different owner conflicts
-- invalidate an old history review and automatically reopen it.
create table if not exists public.commerce_shopee_sales_history_reviews_v1(
  source_sku_norm text primary key
    check(length(source_sku_norm) between 1 and 160),
  review_reason text not null
    check(review_reason in ('NO_ACTIVE_LISTING','DUPLICATE_SKU')),
  reviewed_units bigint not null check(reviewed_units>0),
  reviewed_revenue numeric(18,2) not null,
  reviewed_period_end date not null,
  evidence text not null check(length(btrim(evidence)) between 8 and 500),
  reviewed_by text not null,
  reviewed_at timestamptz not null default now(),
  active boolean not null default true,
  reopened_by text,
  reopened_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.commerce_shopee_sales_history_reviews_v1 enable row level security;
revoke all on public.commerce_shopee_sales_history_reviews_v1 from public,anon,authenticated;
grant select,insert,update on public.commerce_shopee_sales_history_reviews_v1 to service_role;

-- Explicit, administrator-confirmed historical review. Unlike sale aliases,
-- this deliberately has NO listing_product_id and does not alter sales rows.
create or replace function public.commerce_shopee_review_unlinked_history_v1(
  p_actor text,p_evidence text,p_confirmed boolean
) returns jsonb language plpgsql volatile security invoker set search_path=public as $fn$
declare v_count integer;v_units bigint;v_revenue numeric;v_reason_duplicate integer;
begin
  if p_confirmed is distinct from true
    or length(btrim(coalesce(p_evidence,''))) not between 8 and 500
    or nullif(btrim(coalesce(p_actor,'')),'') is null
  then raise exception 'É necessária aprovação explícita do histórico pelo administrador.';end if;
  perform pg_advisory_xact_lock(2026,2711);
  with sales as (
    select public.commerce_nisti_sku_norm_v1(r.sku_norm) sku,
      sum(r.units)::bigint units,round(sum(r.product_revenue),2)::numeric revenue,
      max(r.period_end)::date last_day
    from public.commerce_sales_rows r
    join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
    where r.platform_code='SHOPEE'
    group by 1
  ), owners as (
    select public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku,
      count(*)::integer owner_count
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where m.code='SHOPEE' and l.listing_status='ACTIVE'
      and lp.relation_status<>'REMOVED'
      and nullif(lp.variation_id,'') is not null
    group by 1
  ), eligible as (
    select s.*,case when coalesce(o.owner_count,0)>1
      then 'DUPLICATE_SKU' else 'NO_ACTIVE_LISTING' end reason
    from sales s
    left join owners o on o.sku=s.sku
    left join public.commerce_shopee_sales_sku_alias_reviews_v1 a
      on a.source_sku_norm=s.sku and a.active
    where coalesce(o.owner_count,0)<>1 and a.source_sku_norm is null
  ), inserted as (
    insert into public.commerce_shopee_sales_history_reviews_v1(
      source_sku_norm,review_reason,reviewed_units,reviewed_revenue,
      reviewed_period_end,evidence,reviewed_by,reviewed_at,
      active,reopened_by,reopened_at,updated_at
    )
    select e.sku,e.reason,e.units,e.revenue,e.last_day,
      btrim(p_evidence),left(btrim(p_actor),120),now(),true,null,null,now()
    from eligible e
    where not exists(
      select 1 from public.commerce_shopee_sales_history_reviews_v1 h
      where h.source_sku_norm=e.sku and h.active
        and h.review_reason=e.reason and h.reviewed_units=e.units
        and h.reviewed_revenue=e.revenue and h.reviewed_period_end=e.last_day
    )
    on conflict(source_sku_norm) do update set
      review_reason=excluded.review_reason,
      reviewed_units=excluded.reviewed_units,
      reviewed_revenue=excluded.reviewed_revenue,
      reviewed_period_end=excluded.reviewed_period_end,
      evidence=excluded.evidence,
      reviewed_by=excluded.reviewed_by,
      reviewed_at=excluded.reviewed_at,
      active=true,reopened_by=null,reopened_at=null,updated_at=now()
    returning source_sku_norm,reviewed_units,reviewed_revenue,review_reason
  )
  select count(*)::int,coalesce(sum(reviewed_units),0)::bigint,
    coalesce(round(sum(reviewed_revenue),2),0)::numeric,
    count(*) filter(where review_reason='DUPLICATE_SKU')::int
    into v_count,v_units,v_revenue,v_reason_duplicate from inserted;
  return jsonb_build_object(
    'reviewed_skus',v_count,'reviewed_units',v_units,'reviewed_revenue',v_revenue,
    'duplicate_skus',v_reason_duplicate,
    'linked_units_added',0,'classification','REVIEWED_WITHOUT_LISTING',
    'reversible',true);
end $fn$;

create or replace function public.commerce_shopee_reopen_unlinked_history_v1(
  p_source_sku text,p_actor text
) returns jsonb language plpgsql volatile security invoker set search_path=public as $fn$
declare v_sku text;v_rows int;
begin
  v_sku:=public.commerce_nisti_sku_norm_v1(p_source_sku);
  if nullif(v_sku,'') is null or nullif(btrim(coalesce(p_actor,'')),'') is null
    then raise exception 'SKU e administrador obrigatórios.';end if;
  update public.commerce_shopee_sales_history_reviews_v1
  set active=false,reopened_at=now(),reopened_by=left(btrim(p_actor),120),updated_at=now()
  where source_sku_norm=v_sku and active;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'Histórico não estava aprovado.';end if;
  return jsonb_build_object('source_sku',v_sku,'reviewed',false);
end $fn$;

revoke all on function public.commerce_shopee_review_unlinked_history_v1(text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_review_unlinked_history_v1(text,text,boolean)
  to service_role;
revoke all on function public.commerce_shopee_reopen_unlinked_history_v1(text,text)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_reopen_unlinked_history_v1(text,text)
  to service_role;

-- The queue is derived from the current snapshot, so approved history does
-- not disguise missing daily sales as listing-level coverage.

create or replace function public.commerce_shopee_sku_reconciliation_queue_v1(
  p_search text default null,p_state text default 'PENDING',
  p_limit integer default 20,p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with filter as (
  select nullif(left(btrim(coalesce(p_search,'')),120),'') query,
    case when upper(p_state) in ('APPROVED','REVIEWED') then upper(p_state) else 'PENDING' end state,
    greatest(1,least(coalesce(p_limit,20),50)) lim,
    greatest(0,least(coalesce(p_offset,0),10000)) offs
), sales as (
  select public.commerce_nisti_sku_norm_v1(r.sku_norm) sku,
    sum(r.units)::bigint units,round(sum(r.product_revenue),2)::numeric revenue,
    (array_agg(coalesce(r.product_name,'') order by r.units desc))[1] title,
    count(distinct r.period_start)::int months,
    max(r.period_end)::date last_day
  from public.commerce_sales_rows r
  join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
  where r.platform_code='SHOPEE' group by 1
), variants as (
  select lp.id variation_id,lp.listing_id,l.external_listing_id,l.title listing_title,
    lp.variation_name,lp.platform_sku,
    public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
), owners as (
  select norm,count(*) owners from variants
  where norm is not null group by norm
), candidates as (
  select s.sku,
    case
      when s.sku~'^PB(25|26)' then 'PB27'||substr(s.sku,5)
      when s.sku~'^AGMT(25|26)' then 'AGMT27'||substr(s.sku,7)
      when s.sku~'^PLAN(25|26)' then 'PLAN27'||substr(s.sku,7)
      when s.sku~'^CONFIN(25|26)' then 'CONFIN27'||substr(s.sku,9)
      else null end proposed
  from sales s
), suggested as (
  select c.sku,max(v.variation_id) as suggested_variation_id,
    max(v.external_listing_id) as suggested_listing_id,
    max(v.listing_title) as suggested_listing_title,
    max(v.variation_name) as suggested_variation_name,
    max(v.platform_sku) as suggested_sku
  from candidates c
  join variants v on v.norm=c.proposed
  group by c.sku having count(*)=1
), classified as (
  select s.sku,s.units,s.revenue,s.title,s.months,
    case when a.source_sku_norm is not null then 'APPROVED'
      when h.source_sku_norm is not null and coalesce(o.owners,0)>1 then 'DUPLICATE_REVIEWED'
      when h.source_sku_norm is not null then 'HISTORICAL_APPROVED'
      when coalesce(o.owners,0)>1 then 'DUPLICATE_SKU'
      else 'MISSING_ACTIVE_SKU' end status,
    a.listing_product_id approved_variation_id,
    coalesce(a.evidence,h.evidence) evidence,
    coalesce(a.approved_by,h.reviewed_by) approved_by,
    coalesce(a.approved_at,h.reviewed_at) approved_at,
    h.review_reason historical_reason,
    v.external_listing_id approved_listing_id,
    v.platform_sku approved_sku,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_variation_id else null end suggested_variation_id,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_listing_id else null end suggested_listing_id,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_listing_title else null end suggested_listing_title,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_variation_name else null end suggested_variation_name,
    case when o.owners is null and a.source_sku_norm is null then sg.suggested_sku else null end suggested_sku
  from sales s
  left join owners o on o.norm=s.sku
  left join public.commerce_shopee_sales_sku_alias_reviews_v1 a
    on a.source_sku_norm=s.sku and a.active
  left join public.commerce_shopee_sales_history_reviews_v1 h
    on h.source_sku_norm=s.sku and h.active and h.reviewed_units=s.units
      and h.reviewed_revenue=s.revenue and h.reviewed_period_end=s.last_day
      and h.review_reason=(case when coalesce(o.owners,0)>1
        then 'DUPLICATE_SKU' else 'NO_ACTIVE_LISTING' end)
  left join variants v on v.variation_id=a.listing_product_id
  left join suggested sg on sg.sku=s.sku
  where coalesce(o.owners,0)<>1
), searched as (
  select c.* from classified c cross join filter f
  where (f.state='APPROVED' and c.status='APPROVED'
    or f.state='REVIEWED' and c.status in ('HISTORICAL_APPROVED','DUPLICATE_REVIEWED')
    or f.state='PENDING' and c.status in ('DUPLICATE_SKU','MISSING_ACTIVE_SKU'))
    and (f.query is null or c.sku ilike '%'||f.query||'%'
      or c.title ilike '%'||f.query||'%')
), page as (
  select * from searched order by units desc,sku
  limit(select lim from filter) offset(select offs from filter)
)
select jsonb_build_object(
  'pending_skus',(select count(*) from classified where status in ('DUPLICATE_SKU','MISSING_ACTIVE_SKU')),
  'pending_units',(select coalesce(sum(units),0) from classified where status in ('DUPLICATE_SKU','MISSING_ACTIVE_SKU')),
  'pending_revenue',(select coalesce(sum(revenue),0) from classified where status in ('DUPLICATE_SKU','MISSING_ACTIVE_SKU')),
  'reviewed_skus',(select count(*) from classified where status in ('HISTORICAL_APPROVED','DUPLICATE_REVIEWED')),
  'reviewed_units',(select coalesce(sum(units),0) from classified where status in ('HISTORICAL_APPROVED','DUPLICATE_REVIEWED')),
  'reviewed_revenue',(select coalesce(sum(revenue),0) from classified where status in ('HISTORICAL_APPROVED','DUPLICATE_REVIEWED')),
  'candidate_skus',(select count(*) from classified where status='MISSING_ACTIVE_SKU' and suggested_variation_id is not null),
  'approved_skus',(select count(*) from classified where status='APPROVED'),
  'total',(select count(*) from searched),
  'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.units desc,p.sku) from page p),'[]'::jsonb)
);
$fn$;



revoke all on function public.commerce_shopee_sku_reconciliation_queue_v1(text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_sku_reconciliation_queue_v1(text,text,integer,integer)
  to service_role;
