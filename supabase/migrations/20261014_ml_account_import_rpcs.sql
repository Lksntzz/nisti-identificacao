-- Account-safe dedicated import pipeline. Base v1-v4 remain unchanged for audit.
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
$function$


CREATE OR REPLACE FUNCTION public.commerce_commit_import_batch_account_v2(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_batch record; v_row record; v_product_id bigint; v_category_id bigint;
  v_primary text; v_secondary text; v_name text; v_category text;
  v_observed_year integer; v_temporal_type text; v_sku text; v_sku_owner bigint;
  v_product_only_rows integer:=0; v_created_products integer:=0; v_linked_products integer:=0;
  v_base_result jsonb;
begin
  select b.*,m.code as marketplace_code into v_batch
  from public.commerce_import_batches b join public.commerce_marketplaces m on m.id=b.marketplace_id
  where b.id=p_batch_id;
  if v_batch.id is null then raise exception 'batch_not_found' using errcode='22023'; end if;
  if v_batch.status not in ('PARSED','REVIEW') then raise exception 'batch_not_committable' using errcode='22023'; end if;
  if exists(select 1 from public.commerce_import_rows where batch_id=p_batch_id and status in ('PENDING','PROBABLE','CONFLICT','INVALID')) then
    raise exception 'batch_has_unresolved_rows' using errcode='22023';
  end if;
  if exists(select 1 from public.commerce_import_rows where batch_id=p_batch_id and status='NEW_PRODUCT'
    and coalesce(match_method,'') not in ('USER_NEW','USER_NEW_BULK','USER_NEW_BULK_NOT_LISTED')) then
    raise exception 'new_products_not_approved' using errcode='22023';
  end if;

  for v_row in select * from public.commerce_import_rows
    where batch_id=p_batch_id and status in ('MATCHED','NEW_PRODUCT')
      and upper(coalesce(normalized_payload->>'update_hint',''))='NOT_LISTED'
      and nullif(btrim(coalesce(normalized_payload->>'listing_url','')),'') is null
    order by id
  loop
    v_primary:=nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary','')),'');
    v_secondary:=nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary','')),'');
    v_name:=nullif(btrim(coalesce(v_row.normalized_payload->>'product_name','')),'');
    v_category:=nullif(btrim(coalesce(v_row.normalized_payload->>'category','')),'');
    v_observed_year:=nullif(v_row.normalized_payload->>'observed_year','')::integer;
    if v_primary is null or v_name is null then raise exception 'commit_row_missing_required_data:%',v_row.id using errcode='22023'; end if;

    if v_row.status='NEW_PRODUCT' then
      v_category_id:=null;
      if v_category is not null then
        select id into v_category_id from public.commerce_categories
        where lower(btrim(slug))=lower(public.commerce_slug_v1(v_category)) limit 1;
        if v_category_id is null then
          insert into public.commerce_categories(name,slug) values(v_category,public.commerce_slug_v1(v_category)) on conflict do nothing;
          select id into v_category_id from public.commerce_categories
          where lower(btrim(slug))=lower(public.commerce_slug_v1(v_category)) limit 1;
        end if;
      end if;
      v_temporal_type:=case when public.commerce_match_key_v1(v_name) like '%permanente%' then 'PERMANENT'
        when v_observed_year is not null then 'ANNUAL' else 'UNCLASSIFIED' end;
      insert into public.commerce_products(name,category_id,temporal_type,edition_year,internal_status,notes)
      values(v_name,v_category_id,v_temporal_type,case when v_temporal_type='ANNUAL' then v_observed_year else null end,
        'DRAFT',format('Criado por importação comercial; sem anúncio em %s na origem.',v_batch.marketplace_code))
      returning id into v_product_id;
      insert into public.commerce_product_skus(product_id,sku,sku_type,valid_from_year)
      values(v_product_id,v_primary,'CURRENT',v_observed_year);
      if v_secondary is not null and upper(v_secondary)<>upper(v_primary) then
        insert into public.commerce_product_skus(product_id,sku,sku_type,valid_from_year)
        values(v_product_id,v_secondary,'ALIAS',v_observed_year) on conflict do nothing;
      end if;
      v_created_products:=v_created_products+1;
    else
      v_product_id:=v_row.matched_product_id;
      if v_product_id is null or not exists(select 1 from public.commerce_products where id=v_product_id) then
        raise exception 'matched_product_missing:%',v_row.id using errcode='22023';
      end if;
      foreach v_sku in array array[v_primary,v_secondary] loop
        if v_sku is null then continue; end if;
        select product_id into v_sku_owner from public.commerce_product_skus
        where upper(btrim(sku))=upper(v_sku) limit 1;
        if v_sku_owner is not null and v_sku_owner<>v_product_id then
          raise exception 'sku_belongs_to_other_product:%',v_sku using errcode='23505';
        end if;
        if v_sku_owner is null then
          insert into public.commerce_product_skus(product_id,sku,sku_type,valid_from_year)
          values(v_product_id,v_sku,'ALIAS',v_observed_year);
        end if;
      end loop;
      v_linked_products:=v_linked_products+1;
    end if;
    update public.commerce_import_rows
    set status='COMMITTED',matched_product_id=v_product_id,matched_listing_id=null,
        notes=concat_ws(',',nullif(notes,''),'not_listed_confirmed') where id=v_row.id;
    v_product_only_rows:=v_product_only_rows+1;
  end loop;

  v_base_result:=public.commerce_commit_import_batch_account_v1(p_batch_id);
  return jsonb_build_object('batch_id',p_batch_id,'status','COMMITTED',
    'committed_rows',v_product_only_rows+coalesce((v_base_result->>'committed_rows')::integer,0),
    'created_products',v_created_products+coalesce((v_base_result->>'created_products')::integer,0),
    'linked_products',v_linked_products+coalesce((v_base_result->>'linked_products')::integer,0),
    'product_only_rows',v_product_only_rows);
end;
$function$


CREATE OR REPLACE FUNCTION public.commerce_commit_import_batch_account_v3(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_secondary text;
  v_primary text;
  v_secondary_owner bigint;
  v_overrides jsonb := '{}'::jsonb;
  v_entry record;
  v_row_id bigint;
  v_result jsonb;
begin
  if p_batch_id is null or p_batch_id <= 0 then
    raise exception 'batch_id_invalid' using errcode = '22023';
  end if;

  for v_row in
    select id, matched_product_id, normalized_payload
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status = 'MATCHED'
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_secondary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary', '')), '');

    if v_secondary is null or v_primary is null or upper(v_secondary) = upper(v_primary) then
      continue;
    end if;

    select product_id
    into v_secondary_owner
    from public.commerce_product_skus
    where is_active = true
      and upper(btrim(sku)) = upper(v_secondary)
    limit 1;

    if v_secondary_owner is null or v_secondary_owner = v_row.matched_product_id then
      continue;
    end if;

    v_overrides := v_overrides || jsonb_build_object(
      v_row.id::text,
      jsonb_build_object(
        'secondary', v_secondary,
        'primary', v_primary,
        'owner', v_secondary_owner
      )
    );

    update public.commerce_import_rows
    set normalized_payload = normalized_payload - 'sku_secondary'
    where id = v_row.id;
  end loop;

  v_result := public.commerce_commit_import_batch_account_v2(p_batch_id);

  for v_entry in select key, value from jsonb_each(v_overrides)
  loop
    v_row_id := v_entry.key::bigint;
    v_secondary := v_entry.value->>'secondary';
    v_primary := v_entry.value->>'primary';
    v_secondary_owner := (v_entry.value->>'owner')::bigint;

    update public.commerce_import_rows
    set
      normalized_payload = jsonb_set(normalized_payload, '{sku_secondary}', to_jsonb(v_secondary), true),
      notes = concat_ws(',', nullif(notes, ''), format('platform_sku_owned_by_product:%s', v_secondary_owner))
    where id = v_row_id;

    update public.commerce_listing_products lp
    set
      platform_sku = v_secondary,
      product_sku_id = null
    from public.commerce_import_rows r
    where r.id = v_row_id
      and r.matched_listing_id is not null
      and lp.listing_id = r.matched_listing_id
      and lp.product_id = r.matched_product_id
      and upper(btrim(coalesce(lp.platform_sku, ''))) = upper(v_primary);
  end loop;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'secondary_sku_collisions_preserved', (
      select count(*)::integer from jsonb_object_keys(v_overrides)
    )
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.commerce_commit_import_batch_account_v4(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_batch record;
  v_row record;
  v_result jsonb;
  v_sku text;
  v_variation text;
  v_link_id bigint;
  v_existing_product bigint;
  v_product_sku_id bigint;
  v_status_count integer := 0;
  v_variation_count integer := 0;
  v_status_only_count integer := 0;
begin
  select b.id,b.marketplace_id,b.status,b.account_code,m.code as marketplace_code into v_batch
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id=b.marketplace_id
  where b.id=p_batch_id for update of b;
  if v_batch.id is null or v_batch.status not in ('PARSED','REVIEW') then
    raise exception 'batch_not_committable' using errcode='22023';
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

  -- A single source file cannot issue contradictory explicit states for one ID.
  if exists(
    select 1 from public.commerce_import_rows r
    where r.batch_id=p_batch_id and r.status in ('MATCHED','NEW_PRODUCT')
      and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
    group by r.normalized_payload->>'external_listing_id'
    having count(distinct r.normalized_payload->>'source_listing_status')>1
  ) then
    raise exception 'listing_status_conflict_in_batch' using errcode='22023';
  end if;

  -- Generate a stable seller-listing URL ONLY for a verified Mercado Livre MLB ID.
  -- Prefer the previous URL if this listing is already in the catalog.
  update public.commerce_import_rows r
  set normalized_payload=jsonb_set(
    r.normalized_payload,'{listing_url}',
    to_jsonb(coalesce((
      select l.canonical_url from public.commerce_listings l
      where l.marketplace_id=v_batch.marketplace_id
        and l.account_code is not distinct from v_batch.account_code
        and l.external_listing_id=r.normalized_payload->>'external_listing_id'
      limit 1
    ), 'https://produto.mercadolivre.com.br/MLB-' ||
       substring(r.normalized_payload->>'external_listing_id' from 4))),
    true)
  where r.batch_id=p_batch_id and v_batch.marketplace_code='MERCADO_LIVRE'
    and r.status in ('MATCHED','NEW_PRODUCT')
    and coalesce(r.normalized_payload->>'status_only','false')<>'true'
    and nullif(btrim(coalesce(r.normalized_payload->>'listing_url','')),'') is null
    and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$';

  -- A status-only parent line must never be passed as a product to v1/v2/v3.
  update public.commerce_import_rows r set status='IGNORED'
  where r.batch_id=p_batch_id and r.status='MATCHED'
    and r.match_method='LISTING_STATUS_ONLY'
    and r.normalized_payload->>'status_only'='true';
  get diagnostics v_status_only_count=row_count;

  v_result:=public.commerce_commit_import_batch_account_v3(p_batch_id);

  -- Restore persisted status observations as processed rows.
  update public.commerce_import_rows r set status='COMMITTED'
  where r.batch_id=p_batch_id and r.status='IGNORED'
    and r.match_method='LISTING_STATUS_ONLY'
    and r.normalized_payload->>'status_only'='true';

  -- Preserve listings without product SKUs when the official parent line
  -- explicitly identifies their state. Do not create phantom products.
  insert into public.commerce_listings(
    marketplace_id,account_code,external_listing_id,canonical_url,source_url,title,
    listing_status,sales_status,video_status,source,raw_metadata
  )
  select v_batch.marketplace_id,v_batch.account_code,r.normalized_payload->>'external_listing_id',
      'https://produto.mercadolivre.com.br/MLB-' ||
        substring(r.normalized_payload->>'external_listing_id' from 4),
      nullif(btrim(coalesce(r.normalized_payload->>'listing_url','')),''),
      r.normalized_payload->>'product_name',
      r.normalized_payload->>'source_listing_status',
      'UNKNOWN','UNKNOWN','EXCEL',
      jsonb_build_object('status_source','OFFICIAL_ML_WORKBOOK','last_import_batch_id',p_batch_id)
  from (
    select distinct on (normalized_payload->>'external_listing_id') normalized_payload
    from public.commerce_import_rows
    where batch_id=p_batch_id and status='COMMITTED'
      and match_method='LISTING_STATUS_ONLY'
      and normalized_payload->>'status_only'='true'
      and normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
      and coalesce(normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
    order by normalized_payload->>'external_listing_id',id
  ) r
  where v_batch.marketplace_code='MERCADO_LIVRE'
  on conflict do nothing;

  -- Status is updated only from an explicit platform observation.
  -- A missing listing in a partial workbook NEVER means inactive.
  with latest as (
    select distinct on (r.normalized_payload->>'external_listing_id')
      r.normalized_payload->>'external_listing_id' as external_id,
      r.normalized_payload->>'source_listing_status' as observed_status
    from public.commerce_import_rows r
    where r.batch_id=p_batch_id and r.status='COMMITTED'
      and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
      and nullif(btrim(coalesce(r.normalized_payload->>'external_listing_id','')),'') is not null
    order by r.normalized_payload->>'external_listing_id',r.id desc
  )
  update public.commerce_listings l
  set listing_status=latest.observed_status,
      last_checked_at=now(),
      raw_metadata=coalesce(l.raw_metadata,'{}'::jsonb) ||
        jsonb_build_object('status_source','IMPORT_EXPLICIT','last_status_import_batch_id',p_batch_id)
  from latest
  where l.marketplace_id=v_batch.marketplace_id
    and l.account_code is not distinct from v_batch.account_code
    and l.external_listing_id=latest.external_id;
  get diagnostics v_status_count=row_count;

  -- Bind verified individual variations to their original marketplace identity.
  -- A variation cannot silently change its product, even with a repeated SKU.
  for v_row in
    select id,matched_listing_id,matched_product_id,normalized_payload
    from public.commerce_import_rows
    where batch_id=p_batch_id and status='COMMITTED'
      and match_method is distinct from 'LISTING_STATUS_ONLY'
      and matched_listing_id is not null and matched_product_id is not null
      and nullif(btrim(coalesce(normalized_payload->>'source_variation_id','')),'') is not null
    order by id
  loop
    v_variation:=btrim(v_row.normalized_payload->>'source_variation_id');
    v_sku:=nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary',
                               v_row.normalized_payload->>'sku_primary','')),'');
    select product_id into v_existing_product
    from public.commerce_listing_products
    where listing_id=v_row.matched_listing_id and btrim(coalesce(variation_id,''))=v_variation
    limit 1;
    if v_existing_product is not null and v_existing_product<>v_row.matched_product_id then
      raise exception 'variation_identity_product_conflict:%',v_variation using errcode='23505';
    end if;
    if v_existing_product is not null then
      continue;
    end if;
    select lp.id into v_link_id
    from public.commerce_listing_products lp
    where lp.listing_id=v_row.matched_listing_id and lp.product_id=v_row.matched_product_id
      and lp.variation_id is null
      and upper(btrim(coalesce(lp.platform_sku,'')))=upper(coalesce(v_sku,''))
    order by lp.id limit 1;
    if v_link_id is not null then
      update public.commerce_listing_products
      set variation_id=v_variation,
          variation_name=nullif(btrim(v_row.normalized_payload->>'source_variation'),'')
      where id=v_link_id;
    else
      select s.id into v_product_sku_id from public.commerce_product_skus s
      where s.product_id=v_row.matched_product_id
        and upper(btrim(s.sku))=upper(coalesce(v_sku,'')) limit 1;
      insert into public.commerce_listing_products(
        listing_id,product_id,product_sku_id,platform_sku,
        variation_id,variation_name,relation_status
      ) values (
        v_row.matched_listing_id,v_row.matched_product_id,v_product_sku_id,v_sku,
        v_variation,nullif(btrim(v_row.normalized_payload->>'source_variation'),''),'UNKNOWN'
      ) on conflict do nothing;
    end if;
    v_variation_count:=v_variation_count+1;
    v_link_id:=null;
    v_product_sku_id:=null;
    v_existing_product:=null;
  end loop;
  update public.commerce_import_batches b
  set matched_count=(select count(*) from public.commerce_import_rows r
                     where r.batch_id=p_batch_id and r.status='COMMITTED')
  where b.id=p_batch_id;

  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
    'status_only_observations',v_status_only_count,
    'listings_with_explicit_status',v_status_count,
    'verified_variations',v_variation_count);
end $function$


CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_account_v1(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
 v_result jsonb;
 v_count integer := 0;
 v_matched integer;
 v_probable integer;
 v_new integer;
 v_conflict integer;
 v_invalid integer;
begin
 if exists(
   select 1 from public.commerce_import_batches b
   join public.commerce_marketplaces m on m.id=b.marketplace_id
   where b.id=p_batch_id and m.code='MERCADO_LIVRE'
     and (b.account_code is null or b.account_code not in ('ANTIGO','NOVO'))
 ) then
   raise exception 'mercado_livre_account_required' using errcode='22023';
 end if;
 v_result := public.commerce_reconcile_import_batch_v7(p_batch_id);
 -- The official ML parent line can report ACTIVE/INACTIVE without a SKU.
 -- Treat this as a listing observation, NEVER as a manufactured product.
 update public.commerce_import_rows r
 set status='MATCHED',
     error_code=null,
     match_method='LISTING_STATUS_ONLY',
     matched_product_id=null,
     match_score=null,
     matched_listing_id=(
       select l.id from public.commerce_listings l
       join public.commerce_import_batches b on b.marketplace_id=l.marketplace_id
       where b.id=p_batch_id
         and l.account_code is not distinct from b.account_code
         and l.external_listing_id = r.normalized_payload->>'external_listing_id'
       limit 1
     )
 from public.commerce_import_batches b
 join public.commerce_marketplaces m on m.id=b.marketplace_id
 where r.batch_id=p_batch_id and b.id=p_batch_id and m.code='MERCADO_LIVRE'
   and r.normalized_payload->>'status_only'='true'
   and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
   and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
   and r.status='INVALID';
 get diagnostics v_count=row_count;
 select count(*) filter(where status='MATCHED'),
        count(*) filter(where status='PROBABLE'),
        count(*) filter(where status='NEW_PRODUCT'),
        count(*) filter(where status='CONFLICT'),
        count(*) filter(where status='INVALID')
 into v_matched,v_probable,v_new,v_conflict,v_invalid
 from public.commerce_import_rows where batch_id=p_batch_id;
 update public.commerce_import_batches
 set matched_count=v_matched,conflict_count=v_probable+v_conflict,invalid_count=v_invalid,
     status=case when v_probable+v_new+v_conflict+v_invalid>0 then 'REVIEW' else 'PARSED' end
 where id=p_batch_id;
 return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
   'listing_only_observations',v_count,'matched',v_matched,'probable',v_probable,
   'new_products',v_new,'conflicts',v_conflict,'invalid',v_invalid);
end $function$


revoke execute on function public.commerce_commit_import_batch_account_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_commit_import_batch_account_v1(bigint) to service_role;
revoke execute on function public.commerce_commit_import_batch_account_v2(bigint) from public,anon,authenticated;
grant execute on function public.commerce_commit_import_batch_account_v2(bigint) to service_role;
revoke execute on function public.commerce_commit_import_batch_account_v3(bigint) from public,anon,authenticated;
grant execute on function public.commerce_commit_import_batch_account_v3(bigint) to service_role;
revoke execute on function public.commerce_commit_import_batch_account_v4(bigint) from public,anon,authenticated;
grant execute on function public.commerce_commit_import_batch_account_v4(bigint) to service_role;
revoke execute on function public.commerce_reconcile_import_batch_account_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_reconcile_import_batch_account_v1(bigint) to service_role;
