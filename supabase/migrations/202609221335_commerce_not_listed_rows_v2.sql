begin;

create or replace function public.commerce_reconcile_import_batch_v2(p_batch_id bigint)
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
  -- Reuse the established reconciliation for ordinary listing rows first.
  perform public.commerce_reconcile_import_batch_v1(p_batch_id);

  -- Rows explicitly marked as not listed are product evidence, not broken
  -- listing evidence. They participate in product reconciliation but must not
  -- manufacture a marketplace listing merely to satisfy the import pipeline.
  for v_row in
    select id, normalized_payload
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status = 'CONFLICT'
      and error_code = 'listing_url_required'
      and upper(coalesce(normalized_payload->>'update_hint', '')) = 'NOT_LISTED'
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_secondary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary', '')), '');
    v_name := nullif(btrim(coalesce(v_row.normalized_payload->>'product_name', '')), '');
    v_category := nullif(btrim(coalesce(v_row.normalized_payload->>'category', '')), '');

    delete from public.commerce_reconciliation_candidates
    where import_row_id = v_row.id;

    if v_primary is null or v_name is null then
      update public.commerce_import_rows
      set status = 'INVALID', error_code = 'required_identity_missing'
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
        match_method = 'SKU_EXACT_NOT_LISTED',
        match_score = v_top_score,
        error_code = null
      where id = v_row.id;
    elsif v_exact_count > 1 then
      update public.commerce_import_rows
      set
        status = 'CONFLICT',
        match_method = 'MULTIPLE_EXACT_SKU',
        error_code = 'multiple_exact_sku_matches'
      where id = v_row.id;
    elsif v_candidate_count > 0 then
      update public.commerce_import_rows
      set
        status = 'PROBABLE',
        matched_product_id = v_top_product_id,
        match_method = 'PROBABLE_NOT_LISTED',
        match_score = v_top_score,
        error_code = null
      where id = v_row.id;
    else
      update public.commerce_import_rows
      set
        status = 'NEW_PRODUCT',
        matched_product_id = null,
        match_method = 'NO_MATCH_NOT_LISTED',
        match_score = null,
        error_code = null
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
    'ignored', v_ignored,
    'not_listed_rows', (
      select count(*)
      from public.commerce_import_rows
      where batch_id = p_batch_id
        and upper(coalesce(normalized_payload->>'update_hint', '')) = 'NOT_LISTED'
        and nullif(btrim(coalesce(normalized_payload->>'listing_url', '')), '') is null
    )
  );
end;
$$;

create or replace function public.commerce_approve_new_rows_v2(p_batch_id bigint)
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
  set match_method = case
    when upper(coalesce(normalized_payload->>'update_hint', '')) = 'NOT_LISTED'
      and nullif(btrim(coalesce(normalized_payload->>'listing_url', '')), '') is null
      then 'USER_NEW_BULK_NOT_LISTED'
    else 'USER_NEW_BULK'
  end
  where batch_id = p_batch_id
    and status = 'NEW_PRODUCT'
    and match_method in ('NO_MATCH', 'NO_MATCH_NOT_LISTED');

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.commerce_commit_import_batch_v2(p_batch_id bigint)
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
  v_primary text;
  v_secondary text;
  v_name text;
  v_category text;
  v_observed_year integer;
  v_temporal_type text;
  v_sku text;
  v_sku_owner bigint;
  v_product_only_rows integer := 0;
  v_created_products integer := 0;
  v_linked_products integer := 0;
  v_base_result jsonb;
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
      and coalesce(match_method, '') not in (
        'USER_NEW', 'USER_NEW_BULK', 'USER_NEW_BULK_NOT_LISTED'
      )
  ) then
    raise exception 'new_products_not_approved' using errcode = '22023';
  end if;

  for v_row in
    select *
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status in ('MATCHED', 'NEW_PRODUCT')
      and upper(coalesce(normalized_payload->>'update_hint', '')) = 'NOT_LISTED'
      and nullif(btrim(coalesce(normalized_payload->>'listing_url', '')), '') is null
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_secondary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary', '')), '');
    v_name := nullif(btrim(coalesce(v_row.normalized_payload->>'product_name', '')), '');
    v_category := nullif(btrim(coalesce(v_row.normalized_payload->>'category', '')), '');
    v_observed_year := nullif(v_row.normalized_payload->>'observed_year', '')::integer;

    if v_primary is null or v_name is null then
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
        format('Criado por importação comercial; sem anúncio em %s na origem.', v_batch.marketplace_code)
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

      foreach v_sku in array array[v_primary, v_secondary]
      loop
        if v_sku is null then continue; end if;

        select product_id into v_sku_owner
        from public.commerce_product_skus
        where upper(btrim(sku)) = upper(v_sku)
        limit 1;

        if v_sku_owner is not null and v_sku_owner <> v_product_id then
          raise exception 'sku_belongs_to_other_product:%', v_sku using errcode = '23505';
        end if;

        if v_sku_owner is null then
          insert into public.commerce_product_skus(product_id, sku, sku_type, valid_from_year)
          values (v_product_id, v_sku, 'ALIAS', v_observed_year);
        end if;
      end loop;
      v_linked_products := v_linked_products + 1;
    end if;

    update public.commerce_import_rows
    set
      status = 'COMMITTED',
      matched_product_id = v_product_id,
      matched_listing_id = null,
      notes = concat_ws(',', nullif(notes, ''), 'not_listed_confirmed')
    where id = v_row.id;

    v_product_only_rows := v_product_only_rows + 1;
  end loop;

  -- The original commit function now sees only rows that really have a
  -- listing URL. If it fails, PostgreSQL rolls back this entire RPC call,
  -- including product-only rows processed above.
  v_base_result := public.commerce_commit_import_batch_v1(p_batch_id);

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', 'COMMITTED',
    'committed_rows', v_product_only_rows + coalesce((v_base_result->>'committed_rows')::integer, 0),
    'created_products', v_created_products + coalesce((v_base_result->>'created_products')::integer, 0),
    'linked_products', v_linked_products + coalesce((v_base_result->>'linked_products')::integer, 0),
    'product_only_rows', v_product_only_rows
  );
end;
$$;

revoke all on function public.commerce_reconcile_import_batch_v2(bigint) from public, anon, authenticated;
revoke all on function public.commerce_approve_new_rows_v2(bigint) from public, anon, authenticated;
revoke all on function public.commerce_commit_import_batch_v2(bigint) from public, anon, authenticated;

grant execute on function public.commerce_reconcile_import_batch_v2(bigint) to service_role;
grant execute on function public.commerce_approve_new_rows_v2(bigint) to service_role;
grant execute on function public.commerce_commit_import_batch_v2(bigint) to service_role;

commit;
