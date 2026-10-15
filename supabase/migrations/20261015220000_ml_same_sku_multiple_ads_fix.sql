-- Official ML active sellers may reuse full SKU on multiple ads.
-- Scanner stays authoritative. Existing batch #39 can be safely reprocessed.
CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_v1(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
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

    if v_listing_url is null and not (
      coalesce(v_row.normalized_payload->>'marketplace','') = 'MERCADO_LIVRE'
      and upper(coalesce(v_row.normalized_payload->>'external_listing_id','')) ~ '^MLB[0-9]{6,}$'
      and coalesce(v_row.normalized_payload->>'listing_ref','') = coalesce(v_row.normalized_payload->>'external_listing_id','')
    ) then
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
        -- On the official ML workbook, repeat SKUs across different seller
        -- listing IDs are valid. Same MLB ID still receives the normal
        -- duplicate/variation safety verification.
        and (
          coalesce(v_row.normalized_payload->>'marketplace','') <> 'MERCADO_LIVRE'
          or coalesce(v_row.normalized_payload->>'external_listing_id','') !~ '^MLB[0-9]{6,}        and (
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
$function$

          or coalesce(other.normalized_payload->>'external_listing_id','') !~ '^MLB[0-9]{6,}        and (
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
$function$

          or other.normalized_payload->>'external_listing_id' = v_row.normalized_payload->>'external_listing_id'
        )
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
$function$;


-- Existing importer RPC. Always run secure NISTI ID SKU exact/year matching
-- before reviewing ACTIVE listing rows without a proven Scanner identity.
create or replace function public.commerce_reconcile_import_batch_auto_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reconcile jsonb;
  v_auto jsonb;
  v_pending integer := 0;
  v_matched integer := 0;
  v_probable integer := 0;
  v_new integer := 0;
  v_conflict integer := 0;
  v_invalid integer := 0;
begin
  v_reconcile := public.commerce_reconcile_import_batch_account_v2(p_batch_id);
  v_auto := public.commerce_auto_link_ml_active_v1(p_batch_id);

  if coalesce((v_auto->>'skipped')::boolean,false)=false then
    -- NO_MATCH in the ML spreadsheet is not proof of a new Scanner product.
    -- Pending rows are preserved, not automatically bulk-created.
    update public.commerce_import_rows r
    set status='PROBABLE',
        match_method='ML_SCANNER_IDENTITY_PENDING',
        matched_product_id=null,
        match_score=null,
        error_code=null
    where r.batch_id=p_batch_id
      and r.normalized_payload->>'source_listing_status'='ACTIVE'
      and r.normalized_payload->>'status_only' is distinct from 'true'
      and r.status='NEW_PRODUCT'
      and r.match_method in ('NO_MATCH','NO_MATCH_NOT_LISTED');
    get diagnostics v_pending = row_count;

    select count(*) filter (where status='MATCHED'),
           count(*) filter (where status='PROBABLE'),
           count(*) filter (where status='NEW_PRODUCT'),
           count(*) filter (where status='CONFLICT'),
           count(*) filter (where status='INVALID')
    into v_matched,v_probable,v_new,v_conflict,v_invalid
    from public.commerce_import_rows where batch_id=p_batch_id;

    update public.commerce_import_batches b
    set matched_count=v_matched,
        conflict_count=v_probable+v_conflict,
        invalid_count=v_invalid,
        status=case when v_probable+v_new+v_conflict+v_invalid>0
                    then 'REVIEW' else 'PARSED' end
    where b.id=p_batch_id and b.status<>'COMMITTED';
  end if;

  return coalesce(v_reconcile,'{}'::jsonb)
       || jsonb_build_object(
            'automatic_sync',v_auto,
            'unlinked_scanner_review_rows',v_pending,
            'matched',v_matched,'probable',v_probable,
            'new_products',v_new,'conflicts',v_conflict,'invalid',v_invalid
          );
end;
$$;
revoke all on function public.commerce_reconcile_import_batch_auto_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_reconcile_import_batch_auto_v1(bigint) to service_role;
