
create or replace function public.commerce_source_row_sku_v1(p_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path=public
as $$
  select coalesce(
    nullif(btrim(p_payload->>'sku'),''),
    nullif(btrim(p_payload->>'sku_primary'),''),
    nullif(btrim(p_payload->>'sku_base'),''),
    nullif(btrim(p_payload->>'sku_secondary'),'')
  );
$$;

create or replace function public.commerce_source_row_sku_norm_v1(p_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path=public
as $$
  select public.commerce_nisti_sku_norm_v1(public.commerce_source_row_sku_v1(p_payload));
$$;

create or replace function public.commerce_source_row_sku_signature_v1(p_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path=public
as $$
  select nullif(public.commerce_sku_pattern_v1(public.commerce_source_row_sku_v1(p_payload))->>'signature','');
$$;

create or replace function public.commerce_source_row_sku_finish_v1(p_payload jsonb)
returns text
language sql
immutable
security invoker
set search_path=public
as $$
  select coalesce(public.commerce_sku_pattern_v1(public.commerce_source_row_sku_v1(p_payload))->>'finish','');
$$;

create or replace function public.commerce_source_row_sku_year_v1(p_payload jsonb)
returns integer
language sql
immutable
security invoker
set search_path=public
as $$
  select case
    when coalesce(public.commerce_sku_pattern_v1(public.commerce_source_row_sku_v1(p_payload))->>'year','') ~ '^[0-9]{4}$'
      then (public.commerce_sku_pattern_v1(public.commerce_source_row_sku_v1(p_payload))->>'year')::integer
    else null
  end;
$$;

revoke all on function public.commerce_source_row_sku_v1(jsonb) from public,anon,authenticated;
revoke all on function public.commerce_source_row_sku_norm_v1(jsonb) from public,anon,authenticated;
revoke all on function public.commerce_source_row_sku_signature_v1(jsonb) from public,anon,authenticated;
revoke all on function public.commerce_source_row_sku_finish_v1(jsonb) from public,anon,authenticated;
revoke all on function public.commerce_source_row_sku_year_v1(jsonb) from public,anon,authenticated;

grant execute on function public.commerce_source_row_sku_v1(jsonb) to service_role;
grant execute on function public.commerce_source_row_sku_norm_v1(jsonb) to service_role;
grant execute on function public.commerce_source_row_sku_signature_v1(jsonb) to service_role;
grant execute on function public.commerce_source_row_sku_finish_v1(jsonb) to service_role;
grant execute on function public.commerce_source_row_sku_year_v1(jsonb) to service_role;

create index if not exists commerce_source_rows_nisti_sku_norm_idx
  on public.commerce_source_rows (
    public.commerce_source_row_sku_norm_v1(normalized_payload)
  )
  include (id,matched_product_id)
  where is_header=false;

create index if not exists commerce_source_rows_nisti_family_idx
  on public.commerce_source_rows (
    public.commerce_source_row_sku_signature_v1(normalized_payload),
    public.commerce_source_row_sku_finish_v1(normalized_payload),
    public.commerce_source_row_sku_year_v1(normalized_payload)
  )
  include (id,matched_product_id)
  where is_header=false;

create or replace function public.commerce_reconcile_nisti_product_v4(
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
  v_exact_rows integer := 0;
  v_family_rows integer := 0;
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

  if v_exact_safe and v_norm is not null then
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
        'NISTI ID reconciled v4 EXACT → produto '||v_link.commerce_product_id::text
      )
    where r.is_header=false
      and public.commerce_source_row_sku_norm_v1(r.normalized_payload)=v_norm
      and r.matched_product_id is distinct from v_link.commerce_product_id
      and (
        r.matched_product_id is null
        or not exists(
          select 1
          from public.commerce_nisti_product_links existing
          where existing.commerce_product_id=r.matched_product_id
            and existing.sync_status='SYNCED'
        )
      );

    get diagnostics v_exact_rows = row_count;
  end if;

  if v_family_safe and v_signature is not null and v_year is not null then
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
        'NISTI ID reconciled v4 FAMILY → produto '||v_link.commerce_product_id::text
      )
    where r.is_header=false
      and public.commerce_source_row_sku_signature_v1(r.normalized_payload)=v_signature
      and public.commerce_source_row_sku_finish_v1(r.normalized_payload)=v_finish
      and public.commerce_source_row_sku_year_v1(r.normalized_payload) is not null
      and public.commerce_source_row_sku_year_v1(r.normalized_payload)<=v_year
      and r.matched_product_id is distinct from v_link.commerce_product_id
      and (
        r.matched_product_id is null
        or not exists(
          select 1
          from public.commerce_nisti_product_links existing
          where existing.commerce_product_id=r.matched_product_id
            and existing.sync_status='SYNCED'
        )
      );

    get diagnostics v_family_rows = row_count;
  end if;

  return jsonb_build_object(
    'status','SYNCED',
    'nisti_product_id',p_nisti_product_id,
    'commerce_product_id',v_link.commerce_product_id,
    'source_rows_relinked',v_exact_rows+v_family_rows,
    'exact_rows_relinked',v_exact_rows,
    'family_rows_relinked',v_family_rows,
    'exact_safe',v_exact_safe,
    'family_safe',v_family_safe
  );
end;
$$;

revoke all on function public.commerce_reconcile_nisti_product_v4(bigint)
  from public,anon,authenticated;
grant execute on function public.commerce_reconcile_nisti_product_v4(bigint)
  to service_role;
