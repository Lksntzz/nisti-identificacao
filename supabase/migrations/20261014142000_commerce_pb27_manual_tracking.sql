-- Track internal PB27 migration decisions separately from the SKU still live on each marketplace.
create table if not exists public.commerce_listing_year_updates (
  import_row_id bigint primary key references public.commerce_import_rows(id) on delete cascade,
  listing_id bigint references public.commerce_listings(id),
  source_sku text not null,
  target_sku text not null,
  status text not null default 'PENDING_PLATFORM'
    check (status in ('PENDING_PLATFORM','CONFIRMED_MANUALLY')),
  created_by text,
  updated_at timestamptz not null default now()
);
create index if not exists commerce_year_updates_listing_idx on public.commerce_listing_year_updates(listing_id,status);
alter table public.commerce_listing_year_updates enable row level security;
revoke all on public.commerce_listing_year_updates from public, anon, authenticated;

create or replace function public.commerce_catalog_year_targets_v1(p_batch_id bigint)
returns table(import_row_id bigint, source_sku text, suggested_sku text, match_state text, platform_status text)
language sql stable security definer set search_path=public as $$
 with source as (
   select r.id, r.matched_product_id, coalesce(nullif(btrim(r.normalized_payload->>'sku_primary'),''),nullif(btrim(r.normalized_payload->>'sku_secondary'),'')) as sku
   from public.commerce_import_rows r where r.batch_id=p_batch_id
 ), possible as (
   select s.id,s.sku as source_sku,k.sku as proposed,k.product_id
   from source s join public.commerce_product_skus k
     on upper(btrim(k.sku))='PB27'||substr(upper(btrim(s.sku)),5)
     and k.is_active=true
   where upper(s.sku) ~ '^PB(25|26)($|_)'
 ), choices as (
   select p.id, min(p.proposed) as proposed, min(p.product_id) as product_id,count(*) as matches
   from possible p group by p.id
 )
 select s.id,s.sku,
   case when c.matches=1 then c.proposed else null end as suggested_sku,
   case
     when s.sku is null then 'MISSING_SKU'
     when upper(s.sku) ~ '^PB27($|_)' then 'CURRENT'
     when upper(s.sku) !~ '^PB(25|26)($|_)' then 'MANUAL_REVIEW'
     when c.matches is null then 'TARGET_NOT_FOUND'
     when c.matches<>1 then 'AMBIGUOUS'
     when s.matched_product_id is distinct from c.product_id then 'MANUAL_REVIEW'
     else 'VERIFIED_TARGET'
   end,
   coalesce(u.status,'NOT_REGISTERED')
 from source s left join choices c on c.id=s.id
 left join public.commerce_listing_year_updates u on u.import_row_id=s.id
 where s.sku is not null;
$$;
revoke all on function public.commerce_catalog_year_targets_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_catalog_year_targets_v1(bigint) to service_role;

create or replace function public.commerce_catalog_year_decision_v1(p_import_row_id bigint,p_action text,p_actor text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_row public.commerce_import_rows%rowtype;
  v_batch_status text;
  v_target record;
  v_status text;
begin
  select * into v_row from public.commerce_import_rows where id=p_import_row_id for update;
  if not found then raise exception 'import_row_not_found'; end if;
  select status into v_batch_status from public.commerce_import_batches where id=v_row.batch_id;
  if v_batch_status<>'COMMITTED' then raise exception 'batch_not_committed'; end if;
  select * into v_target from public.commerce_catalog_year_targets_v1(v_row.batch_id) where import_row_id=p_import_row_id;
  if p_action='REGISTER_PENDING' then
    if v_target.match_state<>'VERIFIED_TARGET' then raise exception 'pb27_match_requires_review'; end if;
    insert into public.commerce_listing_year_updates(import_row_id,listing_id,source_sku,target_sku,status,created_by)
    values(p_import_row_id,v_row.matched_listing_id,v_target.source_sku,v_target.suggested_sku,'PENDING_PLATFORM',p_actor)
    on conflict(import_row_id) do update set updated_at=now()
      where commerce_listing_year_updates.status='PENDING_PLATFORM'
        and commerce_listing_year_updates.source_sku=excluded.source_sku
        and commerce_listing_year_updates.target_sku=excluded.target_sku;
  elsif p_action='CONFIRM_PLATFORM' then
    update public.commerce_listing_year_updates set status='CONFIRMED_MANUALLY',updated_at=now()
    where import_row_id=p_import_row_id and status='PENDING_PLATFORM';
    if not found then raise exception 'pending_update_not_found'; end if;
  else raise exception 'invalid_action'; end if;
  select status into v_status from public.commerce_listing_year_updates where import_row_id=p_import_row_id;
  return jsonb_build_object('import_row_id',p_import_row_id,'status',v_status);
end;
$$;
revoke all on function public.commerce_catalog_year_decision_v1(bigint,text,text) from public,anon,authenticated;
grant execute on function public.commerce_catalog_year_decision_v1(bigint,text,text) to service_role;
