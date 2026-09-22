begin;

create or replace function public.commerce_match_key_v1(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select nullif(
    btrim(
      regexp_replace(
        translate(
          lower(coalesce(p_value, '')),
          'áàãâäéèêëíìîïóòõôöúùûüçñ',
          'aaaaaeeeeiiiiooooouuuucn'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

create or replace function public.commerce_yearless_match_key_v1(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select nullif(
    btrim(
      regexp_replace(
        coalesce(public.commerce_match_key_v1(p_value), ''),
        '\m20(?:2[0-9]|3[0-9])\M',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

create or replace function public.commerce_slug_v1(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select nullif(replace(public.commerce_match_key_v1(p_value), ' ', '-'), '');
$$;

create or replace function public.commerce_reconcile_import_batch_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_primary text;
  v_secondary text;
  v_name text;
  v_category text;
  v_listing_url text;
  v_exact_count integer;
  v_candidate_count integer;
  v_top_product_id bigint;
  v_top_score numeric(6,5);
  v_matched integer;
  v_probable integer;
  v_new integer;
  v_conflict integer;
  v_invalid integer;
  v_ignored integer;
  v_batch_status text;
begin
  if p_batch_id is null or p_batch_id <= 0 then
    raise exception 'batch_id_invalid' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.commerce_import_batches
    where id = p_batch_id and status in ('PARSED', 'REVIEW')
  ) then
    raise exception 'batch_not_reconcilable' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.commerce_import_rows
    where batch_id = p_batch_id
      and coalesce(match_method, '') like 'USER_%'
  ) then
    raise exception 'batch_has_manual_decisions' using errcode = '22023';
  end if;

  delete from public.commerce_reconciliation_candidates c
  using public.commerce_import_rows r
  where c.import_row_id = r.id
    and r.batch_id = p_batch_id;

  update public.commerce_import_rows
  set
    status = case when status = 'INVALID' then 'INVALID' else 'PENDING' end,
    matched_product_id = null,
    matched_listing_id = null,
    match_method = null,
    match_score = null,
    error_code = case when status = 'INVALID' then error_code else null end
  where batch_id = p_batch_id
    and status not in ('IGNORED', 'COMMITTED');

  for v_row in
    select id, normalized_payload
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status = 'PENDING'
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_secondary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary', '')), '');
    v_name := nullif(btrim(coalesce(v_row.normalized_payload->>'product_name', '')), '');
    v_category := nullif(btrim(coalesce(v_row.normalized_payload->>'category', '')), '');
    v_listing_url := nullif(btrim(coalesce(v_row.normalized_payload->>'listing_url', '')), '');

    if v_primary is null or v_name is null then
      update public.commerce_import_rows
      set status = 'INVALID', error_code = 'required_identity_missing'
      where id = v_row.id;
      continue;
    end if;

    if v_listing_url is null then
      update public.commerce_import_rows
      set status = 'CONFLICT', error_code = 'listing_url_required'
      where id = v_row.id;
      continue;
    end if;

    if exists (
      select 1
      from public.commerce_import_rows other
      where other.batch_id = p_batch_id
        and other.id <> v_row.id
        and other.status <> 'INVALID'
        and (
          upper(btrim(coalesce(other.normalized_payload->>'sku_primary', ''))) in (
            upper(v_primary), upper(coalesce(v_secondary, v_primary))
          )
          or upper(btrim(coalesce(other.normalized_payload->>'sku_secondary', ''))) in (
            upper(v_primary), upper(coalesce(v_secondary, v_primary))
          )
        )
        and (
          btrim(coalesce(other.normalized_payload->>'sku_primary', '')) <> ''
          or btrim(coalesce(other.normalized_payload->>'sku_secondary', '')) <> ''
        )
    ) then
      update public.commerce_import_rows
      set status = 'CONFLICT', error_code = 'duplicate_sku_in_batch'
      where id = v_row.id;
      continue;
    end if;

    with candidates as (
      select s.product_id, 'SKU_EXACT'::text as method, 1.00000::numeric(6,5) as score
      from public.commerce_product_skus s
      where s.is_active = true
        and upper(btrim(s.sku)) in (upper(v_primary), upper(coalesce(v_secondary, v_primary)))

      union all

      select lp.product_id, 'PLATFORM_SKU_EXACT'::text, 0.99000::numeric(6,5)
      from public.commerce_listing_products lp
      where lp.platform_sku is not null
        and upper(btrim(lp.platform_sku)) in (upper(v_primary), upper(coalesce(v_secondary, v_primary)))

      union all

      select p.id,
        case
          when public.commerce_match_key_v1(c.name) = public.commerce_match_key_v1(v_category)
            then 'NAME_CATEGORY_EXACT'
          else 'NAME_EXACT'
        end,
        case
          when public.commerce_match_key_v1(c.name) = public.commerce_match_key_v1(v_category)
            then 0.95000::numeric(6,5)
          else 0.92000::numeric(6,5)
        end
      from public.commerce_products p
      left join public.commerce_categories c on c.id = p.category_id
      where public.commerce_match_key_v1(p.name) = public.commerce_match_key_v1(v_name)

      union all

      select p.id, 'NAME_YEARLESS_EXACT'::text, 0.88000::numeric(6,5)
      from public.commerce_products p
      where public.commerce_yearless_match_key_v1(v_name) is not null
        and public.commerce_yearless_match_key_v1(p.name) = public.commerce_yearless_match_key_v1(v_name)
        and public.commerce_match_key_v1(p.name) <> public.commerce_match_key_v1(v_name)
    ), best as (
      select distinct on (product_id) product_id, method, score
      from candidates
      order by product_id, score desc, method
    ), ranked as (
      select product_id, method, score,
        row_number() over (order by score desc, product_id)::integer as rank
      from best
    )
    insert into public.commerce_reconciliation_candidates (
      import_row_id, product_id, match_method, match_score, rank
    )
    select v_row.id, product_id, method, score, rank
    from ranked
    order by rank;

    select
      count(*) filter (where match_score >= 0.99000)::integer,
      count(*)::integer
    into v_exact_count, v_candidate_count
    from public.commerce_reconciliation_candidates
    where import_row_id = v_row.id;

    select product_id, match_score
    into v_top_product_id, v_top_score
    from public.commerce_reconciliation_candidates
    where import_row_id = v_row.id
    order by rank
    limit 1;

    if v_exact_count = 1 then
      select product_id, match_score
      into v_top_product_id, v_top_score
      from public.commerce_reconciliation_candidates
      where import_row_id = v_row.id
        and match_score >= 0.99000
      order by match_score desc, rank
      limit 1;

      update public.commerce_import_rows
      set
        status = 'MATCHED',
        matched_product_id = v_top_product_id,
        match_method = 'SKU_EXACT',
        match_score = v_top_score,
        error_code = null
      where id = v_row.id;
    elsif v_exact_count > 1 then
      update public.commerce_import_rows
      set status = 'CONFLICT', match_method = 'MULTIPLE_EXACT_SKU', error_code = 'multiple_exact_sku_matches'
      where id = v_row.id;
    elsif v_candidate_count > 0 then
      update public.commerce_import_rows
      set
        status = 'PROBABLE',
        matched_product_id = v_top_product_id,
        match_method = 'PROBABLE_CANDIDATE',
        match_score = v_top_score,
        error_code = null
      where id = v_row.id;
    else
      update public.commerce_import_rows
      set status = 'NEW_PRODUCT', match_method = 'NO_MATCH', match_score = null, error_code = null
      where id = v_row.id;
    end if;
  end loop;

  select
    count(*) filter (where status = 'MATCHED')::integer,
    count(*) filter (where status = 'PROBABLE')::integer,
    count(*) filter (where status = 'NEW_PRODUCT')::integer,
    count(*) filter (where status = 'CONFLICT')::integer,
    count(*) filter (where status = 'INVALID')::integer,
    count(*) filter (where status = 'IGNORED')::integer
  into v_matched, v_probable, v_new, v_conflict, v_invalid, v_ignored
  from public.commerce_import_rows
  where batch_id = p_batch_id;

  v_batch_status := case
    when v_probable > 0 or v_new > 0 or v_conflict > 0 or v_invalid > 0 then 'REVIEW'
    else 'PARSED'
  end;

  update public.commerce_import_batches
  set
    status = v_batch_status,
    matched_count = v_matched,
    conflict_count = v_probable + v_conflict,
    invalid_count = v_invalid
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_batch_status,
    'matched', v_matched,
    'probable', v_probable,
    'new_products', v_new,
    'conflicts', v_conflict,
    'invalid', v_invalid,
    'ignored', v_ignored
  );
end;
$$;

create or replace function public.commerce_list_import_rows_v1(
  p_batch_id bigint,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint,
  sheet_name text,
  row_number integer,
  status text,
  normalized_payload jsonb,
  matched_product_id bigint,
  match_method text,
  match_score numeric,
  error_code text,
  notes text,
  candidates jsonb,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.id,
    r.sheet_name,
    r.row_number,
    r.status,
    r.normalized_payload,
    r.matched_product_id,
    r.match_method,
    r.match_score,
    r.error_code,
    r.notes,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', c.product_id,
          'product_name', p.name,
          'current_sku', cs.sku,
          'method', c.match_method,
          'score', c.match_score,
          'rank', c.rank,
          'confirmed', c.is_confirmed
        ) order by c.rank
      )
      from public.commerce_reconciliation_candidates c
      join public.commerce_products p on p.id = c.product_id
      left join lateral (
        select sku
        from public.commerce_product_skus s
        where s.product_id = p.id and s.sku_type = 'CURRENT' and s.is_active = true
        order by s.id desc
        limit 1
      ) cs on true
      where c.import_row_id = r.id
    ), '[]'::jsonb) as candidates,
    count(*) over() as total_count
  from public.commerce_import_rows r
  where r.batch_id = p_batch_id
    and (p_status is null or upper(r.status) = upper(btrim(p_status)))
  order by r.sheet_name, r.row_number, r.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.commerce_decide_import_row_v1(
  p_import_row_id bigint,
  p_action text,
  p_product_id bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_batch_id bigint;
  v_status text;
begin
  select batch_id, status into v_batch_id, v_status
  from public.commerce_import_rows
  where id = p_import_row_id;

  if v_batch_id is null then
    raise exception 'import_row_not_found' using errcode = '22023';
  end if;

  if exists(select 1 from public.commerce_import_batches where id = v_batch_id and status = 'COMMITTED') then
    raise exception 'batch_already_committed' using errcode = '22023';
  end if;

  if v_action = 'CONFIRM_PRODUCT' then
    if p_product_id is null or not exists(select 1 from public.commerce_products where id = p_product_id) then
      raise exception 'product_not_found' using errcode = '22023';
    end if;

    update public.commerce_import_rows
    set
      status = 'MATCHED',
      matched_product_id = p_product_id,
      match_method = 'USER_CONFIRMED',
      match_score = 1.00000,
      error_code = null
    where id = p_import_row_id;

    update public.commerce_reconciliation_candidates
    set is_confirmed = (product_id = p_product_id)
    where import_row_id = p_import_row_id;
  elsif v_action = 'CREATE_NEW' then
    update public.commerce_import_rows
    set
      status = 'NEW_PRODUCT',
      matched_product_id = null,
      match_method = 'USER_NEW',
      match_score = null,
      error_code = null
    where id = p_import_row_id;

    update public.commerce_reconciliation_candidates
    set is_confirmed = false
    where import_row_id = p_import_row_id;
  elsif v_action = 'IGNORE' then
    update public.commerce_import_rows
    set
      status = 'IGNORED',
      matched_product_id = null,
      match_method = 'USER_IGNORED',
      match_score = null,
      error_code = null
    where id = p_import_row_id;

    update public.commerce_reconciliation_candidates
    set is_confirmed = false
    where import_row_id = p_import_row_id;
  else
    raise exception 'decision_action_invalid' using errcode = '22023';
  end if;

  update public.commerce_import_batches b
  set
    matched_count = (select count(*) from public.commerce_import_rows r where r.batch_id = b.id and r.status = 'MATCHED'),
    conflict_count = (select count(*) from public.commerce_import_rows r where r.batch_id = b.id and r.status in ('PROBABLE', 'CONFLICT')),
    invalid_count = (select count(*) from public.commerce_import_rows r where r.batch_id = b.id and r.status = 'INVALID'),
    status = 'REVIEW'
  where b.id = v_batch_id;

  return jsonb_build_object(
    'row_id', p_import_row_id,
    'action', v_action,
    'batch_id', v_batch_id
  );
end;
$$;

create or replace function public.commerce_approve_new_rows_v1(p_batch_id bigint)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists(select 1 from public.commerce_import_batches where id = p_batch_id and status = 'REVIEW') then
    raise exception 'batch_not_in_review' using errcode = '22023';
  end if;

  update public.commerce_import_rows
  set match_method = 'USER_NEW_BULK'
  where batch_id = p_batch_id
    and status = 'NEW_PRODUCT'
    and match_method = 'NO_MATCH';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.commerce_commit_import_batch_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch record;
  v_row record;
  v_product_id bigint;
  v_category_id bigint;
  v_listing_id bigint;
  v_listing_match_count integer;
  v_primary text;
  v_secondary text;
  v_platform_sku text;
  v_name text;
  v_category text;
  v_listing_url text;
  v_external_id text;
  v_video_status text;
  v_observed_year integer;
  v_temporal_type text;
  v_sku_owner bigint;
  v_product_sku_id bigint;
  v_created_products integer := 0;
  v_linked_products integer := 0;
  v_committed_rows integer := 0;
begin
  select b.*, m.code as marketplace_code
  into v_batch
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id = b.marketplace_id
  where b.id = p_batch_id;

  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = '22023';
  end if;
  if v_batch.status not in ('PARSED', 'REVIEW') then
    raise exception 'batch_not_committable' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.commerce_import_rows
    where batch_id = p_batch_id
      and status in ('PENDING', 'PROBABLE', 'CONFLICT', 'INVALID')
  ) then
    raise exception 'batch_has_unresolved_rows' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.commerce_import_rows
    where batch_id = p_batch_id
      and status = 'NEW_PRODUCT'
      and coalesce(match_method, '') not in ('USER_NEW', 'USER_NEW_BULK')
  ) then
    raise exception 'new_products_not_approved' using errcode = '22023';
  end if;

  for v_row in
    select *
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status in ('MATCHED', 'NEW_PRODUCT')
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_secondary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary', '')), '');
    v_name := nullif(btrim(coalesce(v_row.normalized_payload->>'product_name', '')), '');
    v_category := nullif(btrim(coalesce(v_row.normalized_payload->>'category', '')), '');
    v_listing_url := nullif(btrim(coalesce(v_row.normalized_payload->>'listing_url', '')), '');
    v_external_id := nullif(btrim(coalesce(v_row.normalized_payload->>'external_listing_id', '')), '');
    v_video_status := upper(btrim(coalesce(v_row.normalized_payload->>'video_status', 'UNKNOWN')));
    v_observed_year := nullif(v_row.normalized_payload->>'observed_year', '')::integer;
    v_platform_sku := coalesce(v_secondary, v_primary);

    if v_primary is null or v_name is null or v_listing_url is null then
      raise exception 'commit_row_missing_required_data:%', v_row.id using errcode = '22023';
    end if;

    if v_row.status = 'NEW_PRODUCT' then
      v_category_id := null;
      if v_category is not null then
        select id into v_category_id
        from public.commerce_categories
        where lower(btrim(slug)) = lower(public.commerce_slug_v1(v_category))
        limit 1;

        if v_category_id is null then
          insert into public.commerce_categories(name, slug)
          values (v_category, public.commerce_slug_v1(v_category))
          on conflict do nothing;

          select id into v_category_id
          from public.commerce_categories
          where lower(btrim(slug)) = lower(public.commerce_slug_v1(v_category))
          limit 1;
        end if;
      end if;

      v_temporal_type := case
        when public.commerce_match_key_v1(v_name) like '%permanente%' then 'PERMANENT'
        when v_observed_year is not null then 'ANNUAL'
        else 'UNCLASSIFIED'
      end;

      insert into public.commerce_products (
        name, category_id, temporal_type, edition_year, internal_status, notes
      ) values (
        v_name,
        v_category_id,
        v_temporal_type,
        case when v_temporal_type = 'ANNUAL' then v_observed_year else null end,
        'DRAFT',
        'Criado por importação comercial aprovada.'
      ) returning id into v_product_id;

      insert into public.commerce_product_skus(product_id, sku, sku_type, valid_from_year)
      values (v_product_id, v_primary, 'CURRENT', v_observed_year);

      if v_secondary is not null and upper(v_secondary) <> upper(v_primary) then
        insert into public.commerce_product_skus(product_id, sku, sku_type, valid_from_year)
        values (v_product_id, v_secondary, 'ALIAS', v_observed_year)
        on conflict do nothing;
      end if;

      v_created_products := v_created_products + 1;
    else
      v_product_id := v_row.matched_product_id;
      if v_product_id is null or not exists(select 1 from public.commerce_products where id = v_product_id) then
        raise exception 'matched_product_missing:%', v_row.id using errcode = '22023';
      end if;

      foreach v_primary in array array[v_primary, v_secondary]
      loop
        if v_primary is null then continue; end if;

        select product_id into v_sku_owner
        from public.commerce_product_skus
        where upper(btrim(sku)) = upper(v_primary)
        limit 1;

        if v_sku_owner is not null and v_sku_owner <> v_product_id then
          raise exception 'sku_belongs_to_other_product:%', v_primary using errcode = '23505';
        end if;

        if v_sku_owner is null then
          insert into public.commerce_product_skus(product_id, sku, sku_type, valid_from_year)
          values (v_product_id, v_primary, 'ALIAS', v_observed_year);
        end if;
      end loop;
      v_linked_products := v_linked_products + 1;
    end if;

    select count(distinct id)::integer, min(id)
    into v_listing_match_count, v_listing_id
    from public.commerce_listings
    where marketplace_id = v_batch.marketplace_id
      and (
        (v_external_id is not null and external_listing_id = v_external_id)
        or canonical_url = v_listing_url
      );

    if v_listing_match_count > 1 then
      raise exception 'listing_identity_conflict:%', v_row.id using errcode = '23505';
    end if;

    if v_listing_id is null then
      insert into public.commerce_listings (
        marketplace_id,
        external_listing_id,
        canonical_url,
        source_url,
        title,
        listing_status,
        sales_status,
        video_status,
        observed_year,
        source,
        raw_metadata
      ) values (
        v_batch.marketplace_id,
        v_external_id,
        v_listing_url,
        v_listing_url,
        v_name,
        'UNKNOWN',
        'UNKNOWN',
        case when v_video_status in ('ACTIVE', 'ABSENT', 'DISABLED') then v_video_status else 'UNKNOWN' end,
        v_observed_year,
        'EXCEL',
        jsonb_build_object('import_batch_id', p_batch_id, 'source_sheet', v_row.sheet_name, 'source_row', v_row.row_number)
      ) returning id into v_listing_id;
    else
      update public.commerce_listings
      set
        external_listing_id = coalesce(v_external_id, external_listing_id),
        canonical_url = v_listing_url,
        source_url = v_listing_url,
        title = coalesce(v_name, title),
        video_status = case when v_video_status in ('ACTIVE', 'ABSENT', 'DISABLED') then v_video_status else video_status end,
        observed_year = coalesce(v_observed_year, observed_year),
        source = 'EXCEL',
        raw_metadata = raw_metadata || jsonb_build_object('last_import_batch_id', p_batch_id)
      where id = v_listing_id;
    end if;

    select id into v_product_sku_id
    from public.commerce_product_skus
    where product_id = v_product_id
      and upper(btrim(sku)) = upper(v_platform_sku)
    limit 1;

    insert into public.commerce_listing_products (
      listing_id,
      product_id,
      product_sku_id,
      platform_sku,
      relation_status
    ) values (
      v_listing_id,
      v_product_id,
      v_product_sku_id,
      v_platform_sku,
      'UNKNOWN'
    ) on conflict do nothing;

    update public.commerce_import_rows
    set status = 'COMMITTED', matched_product_id = v_product_id, matched_listing_id = v_listing_id
    where id = v_row.id;

    v_committed_rows := v_committed_rows + 1;
  end loop;

  update public.commerce_import_batches
  set
    status = 'COMMITTED',
    matched_count = (select count(*) from public.commerce_import_rows where batch_id = p_batch_id and status = 'COMMITTED'),
    conflict_count = 0,
    invalid_count = 0,
    completed_at = now()
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'COMMITTED',
    'committed_rows', v_committed_rows,
    'created_products', v_created_products,
    'linked_products', v_linked_products
  );
end;
$$;

revoke all on function public.commerce_match_key_v1(text) from public, anon, authenticated;
revoke all on function public.commerce_yearless_match_key_v1(text) from public, anon, authenticated;
revoke all on function public.commerce_slug_v1(text) from public, anon, authenticated;
revoke all on function public.commerce_reconcile_import_batch_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_list_import_rows_v1(bigint, text, integer, integer) from public, anon, authenticated;
revoke all on function public.commerce_decide_import_row_v1(bigint, text, bigint) from public, anon, authenticated;
revoke all on function public.commerce_approve_new_rows_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_commit_import_batch_v1(bigint) from public, anon, authenticated;

grant execute on function public.commerce_match_key_v1(text) to service_role;
grant execute on function public.commerce_yearless_match_key_v1(text) to service_role;
grant execute on function public.commerce_slug_v1(text) to service_role;
grant execute on function public.commerce_reconcile_import_batch_v1(bigint) to service_role;
grant execute on function public.commerce_list_import_rows_v1(bigint, text, integer, integer) to service_role;
grant execute on function public.commerce_decide_import_row_v1(bigint, text, bigint) to service_role;
grant execute on function public.commerce_approve_new_rows_v1(bigint) to service_role;
grant execute on function public.commerce_commit_import_batch_v1(bigint) to service_role;

commit;
