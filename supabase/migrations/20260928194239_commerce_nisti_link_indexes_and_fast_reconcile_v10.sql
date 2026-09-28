
create or replace function public.commerce_sku_signature_text_v1(p_sku text)
returns text
language sql
immutable
security invoker
set search_path=public
as $$
  select nullif(public.commerce_sku_pattern_v1(p_sku)->>'signature','');
$$;

create or replace function public.commerce_sku_finish_text_v1(p_sku text)
returns text
language sql
immutable
security invoker
set search_path=public
as $$
  select coalesce(public.commerce_sku_pattern_v1(p_sku)->>'finish','');
$$;

create or replace function public.commerce_sku_year_text_v1(p_sku text)
returns integer
language sql
immutable
security invoker
set search_path=public
as $$
  select case
    when coalesce(public.commerce_sku_pattern_v1(p_sku)->>'year','') ~ '^[0-9]{4}$'
      then (public.commerce_sku_pattern_v1(p_sku)->>'year')::integer
    else null
  end;
$$;

revoke all on function public.commerce_sku_signature_text_v1(text) from public,anon,authenticated;
revoke all on function public.commerce_sku_finish_text_v1(text) from public,anon,authenticated;
revoke all on function public.commerce_sku_year_text_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_sku_signature_text_v1(text) to service_role;
grant execute on function public.commerce_sku_finish_text_v1(text) to service_role;
grant execute on function public.commerce_sku_year_text_v1(text) to service_role;

create index if not exists commerce_nisti_links_norm_product_idx
  on public.commerce_nisti_product_links (
    public.commerce_nisti_sku_norm_v1(source_sku)
  )
  include (commerce_product_id,nisti_product_id)
  where sync_status='SYNCED' and commerce_product_id is not null;

create index if not exists commerce_nisti_links_family_year_idx
  on public.commerce_nisti_product_links (
    public.commerce_sku_signature_text_v1(source_sku),
    public.commerce_sku_finish_text_v1(source_sku),
    public.commerce_sku_year_text_v1(source_sku)
  )
  include (commerce_product_id,nisti_product_id)
  where sync_status='SYNCED' and commerce_product_id is not null;

create or replace function public.commerce_reconcile_nisti_product_v5(
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
  v_year := public.commerce_sku_year_text_v1(v_link.source_sku);
  v_signature := public.commerce_sku_signature_text_v1(v_link.source_sku);
  v_finish := public.commerce_sku_finish_text_v1(v_link.source_sku);

  select
    count(distinct l.commerce_product_id)=1
    and min(l.commerce_product_id)=v_link.commerce_product_id
  into v_exact_safe
  from public.commerce_nisti_product_links l
  where l.sync_status='SYNCED'
    and l.commerce_product_id is not null
    and public.commerce_nisti_sku_norm_v1(l.source_sku)=v_norm;

  if v_year is not null and v_signature is not null then
    select max(public.commerce_sku_year_text_v1(l.source_sku))
    into v_family_max_year
    from public.commerce_nisti_product_links l
    where l.sync_status='SYNCED'
      and l.commerce_product_id is not null
      and public.commerce_sku_signature_text_v1(l.source_sku)=v_signature
      and public.commerce_sku_finish_text_v1(l.source_sku)=v_finish
      and public.commerce_sku_year_text_v1(l.source_sku) is not null;

    if v_family_max_year=v_year then
      select
        count(distinct l.commerce_product_id)=1
        and min(l.commerce_product_id)=v_link.commerce_product_id
      into v_family_safe
      from public.commerce_nisti_product_links l
      where l.sync_status='SYNCED'
        and l.commerce_product_id is not null
        and public.commerce_sku_signature_text_v1(l.source_sku)=v_signature
        and public.commerce_sku_finish_text_v1(l.source_sku)=v_finish
        and public.commerce_sku_year_text_v1(l.source_sku)=v_family_max_year;
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
        'NISTI ID reconciled v5 EXACT → produto '||v_link.commerce_product_id::text
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
        'NISTI ID reconciled v5 FAMILY → produto '||v_link.commerce_product_id::text
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

revoke all on function public.commerce_reconcile_nisti_product_v5(bigint)
  from public,anon,authenticated;
grant execute on function public.commerce_reconcile_nisti_product_v5(bigint)
  to service_role;
