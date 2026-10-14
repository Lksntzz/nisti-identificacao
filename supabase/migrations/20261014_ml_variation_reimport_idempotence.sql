-- Prevent duplicate null-variation links during repeated import of an existing seller variation.
CREATE OR REPLACE FUNCTION public.commerce_commit_import_batch_account_v1(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  if v_batch.marketplace_code='MERCADO_LIVRE' then
    if v_batch.account_code is null or v_batch.account_code not in ('ANTIGO','NOVO') then
      raise exception 'mercado_livre_account_required' using errcode='22023';
    end if;
    -- Prevent an existing legacy item with unknown account from being
    -- silently duplicated or claimed by the selected seller account.
    if exists (
      select 1 from public.commerce_import_rows r
      join public.commerce_listings l on l.marketplace_id=v_batch.marketplace_id
       and l.account_code is null
       and l.external_listing_id = r.normalized_payload->>'external_listing_id'
      where r.batch_id=p_batch_id and r.status in ('MATCHED','NEW_PRODUCT')
    ) then
      raise exception 'legacy_listing_account_requires_review' using errcode='22023';
    end if;
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
      and account_code is not distinct from v_batch.account_code
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
        account_code,
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
        v_batch.account_code,
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

    -- Re-import must not manufacture an unscoped duplicate of an existing
    -- marketplace variation. The stable variation ID wins over SKU text.
    if nullif(btrim(coalesce(v_row.normalized_payload->>'source_variation_id','')),'') is null
       or not exists (
         select 1 from public.commerce_listing_products lp
         where lp.listing_id=v_listing_id
           and btrim(coalesce(lp.variation_id,''))=btrim(v_row.normalized_payload->>'source_variation_id')
       ) then
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
    end if;

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
$function$;
revoke execute on function public.commerce_commit_import_batch_account_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_commit_import_batch_account_v1(bigint) to service_role;
