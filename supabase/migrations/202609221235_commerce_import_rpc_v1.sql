begin;

create or replace function public.commerce_create_import_batch_v1(
  p_marketplace_code text,
  p_source_filename text,
  p_source_sha256 text default null,
  p_created_by text default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_marketplace_id bigint;
  v_batch_id bigint;
begin
  if nullif(btrim(coalesce(p_marketplace_code, '')), '') is null then
    raise exception 'marketplace_required' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_source_filename, '')), '') is null then
    raise exception 'source_filename_required' using errcode = '22023';
  end if;
  if p_source_sha256 is not null and p_source_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'source_sha256_invalid' using errcode = '22023';
  end if;

  select id into v_marketplace_id
  from public.commerce_marketplaces
  where upper(code) = upper(btrim(p_marketplace_code))
    and is_active = true
  limit 1;

  if v_marketplace_id is null then
    raise exception 'marketplace_not_found' using errcode = '22023';
  end if;

  insert into public.commerce_import_batches (
    marketplace_id,
    source_filename,
    source_sha256,
    status,
    created_by
  ) values (
    v_marketplace_id,
    btrim(p_source_filename),
    lower(nullif(btrim(coalesce(p_source_sha256, '')), '')),
    'UPLOADED',
    nullif(btrim(coalesce(p_created_by, '')), '')
  )
  returning id into v_batch_id;

  return v_batch_id;
end;
$$;

create or replace function public.commerce_append_import_rows_v1(
  p_batch_id bigint,
  p_rows jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch_exists boolean;
  v_row jsonb;
  v_count integer := 0;
  v_sheet_name text;
  v_row_number integer;
  v_parser_status text;
  v_issues text[];
begin
  if p_batch_id is null or p_batch_id <= 0 then
    raise exception 'batch_id_invalid' using errcode = '22023';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 100 then
    raise exception 'rows_chunk_size_invalid' using errcode = '22023';
  end if;

  select exists(
    select 1
    from public.commerce_import_batches
    where id = p_batch_id
      and status in ('UPLOADED', 'PARSED', 'REVIEW')
  ) into v_batch_exists;

  if not v_batch_exists then
    raise exception 'batch_not_writable' using errcode = '22023';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sheet_name := nullif(btrim(coalesce(v_row->>'sheet_name', '')), '');
    v_row_number := nullif(v_row->>'row_number', '')::integer;
    v_parser_status := upper(btrim(coalesce(v_row->>'parser_status', 'READY')));
    select coalesce(array_agg(value), array[]::text[])
      into v_issues
      from jsonb_array_elements_text(coalesce(v_row->'issues', '[]'::jsonb));

    if v_sheet_name is null or v_row_number is null or v_row_number <= 0 then
      raise exception 'row_position_invalid' using errcode = '22023';
    end if;

    insert into public.commerce_import_rows (
      batch_id,
      sheet_name,
      row_number,
      original_payload,
      normalized_payload,
      status,
      error_code,
      notes
    ) values (
      p_batch_id,
      v_sheet_name,
      v_row_number,
      coalesce(v_row->'original', '{}'::jsonb),
      v_row->'normalized',
      case when v_parser_status = 'INVALID' then 'INVALID' else 'PENDING' end,
      case when v_parser_status = 'INVALID' then coalesce(v_issues[1], 'parser_invalid') else null end,
      case when cardinality(v_issues) > 0 then array_to_string(v_issues, ',') else null end
    )
    on conflict (batch_id, sheet_name, row_number)
    do update set
      original_payload = excluded.original_payload,
      normalized_payload = excluded.normalized_payload,
      status = excluded.status,
      error_code = excluded.error_code,
      notes = excluded.notes,
      matched_product_id = null,
      matched_listing_id = null,
      match_method = null,
      match_score = null;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.commerce_finalize_import_batch_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row_count integer;
  v_invalid_count integer;
  v_sheet_count integer;
  v_status text;
begin
  if not exists(select 1 from public.commerce_import_batches where id = p_batch_id) then
    raise exception 'batch_not_found' using errcode = '22023';
  end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'INVALID')::integer,
    count(distinct sheet_name)::integer
  into v_row_count, v_invalid_count, v_sheet_count
  from public.commerce_import_rows
  where batch_id = p_batch_id;

  if v_row_count = 0 then
    raise exception 'batch_has_no_rows' using errcode = '22023';
  end if;

  v_status := case when v_invalid_count > 0 then 'REVIEW' else 'PARSED' end;

  update public.commerce_import_batches
  set
    status = v_status,
    row_count = v_row_count,
    invalid_count = v_invalid_count,
    sheet_count = v_sheet_count
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_status,
    'row_count', v_row_count,
    'invalid_count', v_invalid_count,
    'sheet_count', v_sheet_count
  );
end;
$$;

create or replace function public.commerce_import_batch_v1(p_batch_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'marketplace_code', m.code,
    'marketplace_name', m.name,
    'source_filename', b.source_filename,
    'source_sha256', b.source_sha256,
    'status', b.status,
    'sheet_count', b.sheet_count,
    'row_count', b.row_count,
    'matched_count', b.matched_count,
    'conflict_count', b.conflict_count,
    'invalid_count', b.invalid_count,
    'created_by', b.created_by,
    'created_at', b.created_at,
    'completed_at', b.completed_at
  )
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id = b.marketplace_id
  where b.id = p_batch_id;
$$;

revoke all on function public.commerce_create_import_batch_v1(text, text, text, text) from public, anon, authenticated;
revoke all on function public.commerce_append_import_rows_v1(bigint, jsonb) from public, anon, authenticated;
revoke all on function public.commerce_finalize_import_batch_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_import_batch_v1(bigint) from public, anon, authenticated;

grant execute on function public.commerce_create_import_batch_v1(text, text, text, text) to service_role;
grant execute on function public.commerce_append_import_rows_v1(bigint, jsonb) to service_role;
grant execute on function public.commerce_finalize_import_batch_v1(bigint) to service_role;
grant execute on function public.commerce_import_batch_v1(bigint) to service_role;

commit;
