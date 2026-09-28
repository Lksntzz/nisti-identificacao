create or replace function public.commerce_reconcile_nisti_product_v3(
  p_nisti_product_id bigint
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_link public.commerce_nisti_product_links%rowtype;
  v_norm text;
  v_pattern jsonb;
  v_year integer;
  v_signature text;
  v_finish text;
  v_exact_safe boolean := false;
  v_family_safe boolean := false;
  v_family_max_year integer;
  v_rows integer := 0;
begin
  select * into v_link
  from public.commerce_nisti_product_links
  where nisti_product_id=p_nisti_product_id
    and sync_status='SYNCED'
    and commerce_product_id is not null;

  if not found then
    return jsonb_build_object('status','SKIPPED','reason','link_not_synced');
  end if;

  v_norm := public.commerce_nisti_sku_norm_v1(v_link.source_sku);
  v_pattern := public.commerce_sku_pattern_v1(v_link.source_sku);
  v_year := case
    when coalesce(v_pattern->>'year','') ~ '^[0-9]{4}$'
      then (v_pattern->>'year')::integer
    else null
  end;
  v_signature := nullif(v_pattern->>'signature','');
  v_finish := coalesce(v_pattern->>'finish','');

  select
    count(distinct l.commerce_product_id)=1
    and min(l.commerce_product_id)=v_link.commerce_product_id
  into v_exact_safe
  from public.commerce_nisti_product_links l
  where l.sync_status='SYNCED'
    and l.commerce_product_id is not null
    and public.commerce_nisti_sku_norm_v1(l.source_sku)=v_norm;

  if v_year is not null and v_signature is not null then
    select max((public.commerce_sku_pattern_v1(l.source_sku)->>'year')::integer)
    into v_family_max_year
    from public.commerce_nisti_product_links l
    where l.sync_status='SYNCED'
      and l.commerce_product_id is not null
      and coalesce(public.commerce_sku_pattern_v1(l.source_sku)->>'year','') ~ '^[0-9]{4}$'
      and public.commerce_sku_pattern_v1(l.source_sku)->>'signature'=v_signature
      and coalesce(public.commerce_sku_pattern_v1(l.source_sku)->>'finish','')=v_finish;

    if v_family_max_year=v_year then
      select
        count(distinct l.commerce_product_id)=1
        and min(l.commerce_product_id)=v_link.commerce_product_id
      into v_family_safe
      from public.commerce_nisti_product_links l
      where l.sync_status='SYNCED'
        and l.commerce_product_id is not null
        and coalesce(public.commerce_sku_pattern_v1(l.source_sku)->>'year','') ~ '^[0-9]{4}$'
        and (public.commerce_sku_pattern_v1(l.source_sku)->>'year')::integer=v_family_max_year
        and public.commerce_sku_pattern_v1(l.source_sku)->>'signature'=v_signature
        and coalesce(public.commerce_sku_pattern_v1(l.source_sku)->>'finish','')=v_finish;
    end if;
  end if;

  with source_values as (
    select
      r.id,
      r.matched_product_id,
      coalesce(
        nullif(btrim(r.normalized_payload->>'sku'),''),
        nullif(btrim(r.normalized_payload->>'sku_primary'),''),
        nullif(btrim(r.normalized_payload->>'sku_base'),''),
        nullif(btrim(r.normalized_payload->>'sku_secondary'),'')
      ) as source_sku
    from public.commerce_source_rows r
    where not r.is_header
      and r.matched_product_id is distinct from v_link.commerce_product_id
      and (
        r.matched_product_id is null
        or not exists(
          select 1
          from public.commerce_nisti_product_links existing
          where existing.commerce_product_id=r.matched_product_id
            and existing.sync_status='SYNCED'
        )
      )
  ),
  parsed as (
    select
      s.id,
      s.source_sku,
      public.commerce_nisti_sku_norm_v1(s.source_sku) as sku_norm,
      public.commerce_sku_pattern_v1(s.source_sku) as pat
    from source_values s
    where s.source_sku is not null
  ),
  eligible as (
    select p.id
    from parsed p
    where
      (v_exact_safe and p.sku_norm=v_norm)
      or (
        v_family_safe
        and coalesce(p.pat->>'year','') ~ '^[0-9]{4}$'
        and (p.pat->>'year')::integer <= v_year
        and p.pat->>'signature'=v_signature
        and coalesce(p.pat->>'finish','')=v_finish
      )
  )
  update public.commerce_source_rows r
  set
    matched_product_id=v_link.commerce_product_id,
    resolution_status=case
      when coalesce(r.resolution_status,'RAW') in ('RAW','UNMATCHED','REFERENCE_ONLY','PRODUCT_MATCHED')
        then 'PRODUCT_MATCHED'
      else r.resolution_status
    end,
    notes=concat_ws(
      ' · ',
      nullif(r.notes,''),
      'NISTI ID reconciled v3 → produto '||v_link.commerce_product_id::text
    )
  from eligible e
  where r.id=e.id;

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'status','SYNCED',
    'nisti_product_id',p_nisti_product_id,
    'commerce_product_id',v_link.commerce_product_id,
    'source_rows_relinked',v_rows,
    'exact_safe',v_exact_safe,
    'family_safe',v_family_safe
  );
end;
$$;

revoke all on function public.commerce_reconcile_nisti_product_v3(bigint)
  from public,anon,authenticated;
grant execute on function public.commerce_reconcile_nisti_product_v3(bigint)
  to service_role;

create or replace function public.commerce_nisti_link_apply_trigger_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if new.sync_status='SYNCED' and new.commerce_product_id is not null then
    perform public.commerce_apply_nisti_link_to_product_v1(new.nisti_product_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_commerce_nisti_link_apply_v1
  on public.commerce_nisti_product_links;

create trigger trg_commerce_nisti_link_apply_v1
after insert or update of commerce_product_id,source_sku,source_name,source_image_url,sync_status
on public.commerce_nisti_product_links
for each row
execute function public.commerce_nisti_link_apply_trigger_v1();
