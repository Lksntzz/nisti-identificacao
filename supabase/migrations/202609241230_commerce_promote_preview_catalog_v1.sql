create or replace function public.commerce_promote_preview_catalog_v1(
  p_expected_products bigint,
  p_expected_skus bigint,
  p_expected_listings bigint,
  p_expected_links bigint,
  p_expected_source_files bigint,
  p_expected_source_rows bigint,
  p_operator text
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_bad bigint;
  v_marketplace_diff bigint;
  v_live_nonempty bigint;
begin
  if coalesce(p_expected_products,0) <= 0
     or coalesce(p_expected_skus,0) <= 0
     or coalesce(p_expected_listings,0) <= 0
     or coalesce(p_expected_links,0) <= 0 then
    raise exception using errcode='22023', message='invalid_expected_counts';
  end if;

  if (select count(*) from public.commerce_preview_products) <> p_expected_products
     or (select count(*) from public.commerce_preview_product_skus) <> p_expected_skus
     or (select count(*) from public.commerce_preview_listings) <> p_expected_listings
     or (select count(*) from public.commerce_preview_listing_products) <> p_expected_links
     or (select count(*) from public.commerce_preview_source_files) <> p_expected_source_files
     or (select count(*) from public.commerce_preview_source_rows) <> p_expected_source_rows then
    raise exception using errcode='P0001', message='preview_counts_changed';
  end if;

  select count(*) into v_bad
  from public.commerce_preview_catalog_audit_v3()
  where severity in ('BLOCKER','REVIEW','WARN')
    and violations > 0;

  if v_bad <> 0 then
    raise exception using errcode='P0001', message='preview_audit_not_clean';
  end if;

  select count(*) into v_marketplace_diff
  from (
    select id,code,name,is_active from public.commerce_preview_marketplaces
    except
    select id,code,name,is_active from public.commerce_marketplaces
    union all
    select id,code,name,is_active from public.commerce_marketplaces
    except
    select id,code,name,is_active from public.commerce_preview_marketplaces
  ) q;

  if v_marketplace_diff <> 0 then
    raise exception using errcode='P0001', message='marketplace_seed_mismatch';
  end if;

  select
    (select count(*) from public.commerce_categories) +
    (select count(*) from public.commerce_subcategories) +
    (select count(*) from public.commerce_products) +
    (select count(*) from public.commerce_product_skus) +
    (select count(*) from public.commerce_listings) +
    (select count(*) from public.commerce_listing_products) +
    (select count(*) from public.commerce_source_files) +
    (select count(*) from public.commerce_source_rows)
  into v_live_nonempty;

  if v_live_nonempty <> 0 then
    raise exception using errcode='P0001', message='live_catalog_not_empty';
  end if;

  insert into public.commerce_categories(
    id,name,slug,is_active,created_at,updated_at
  )
  select id,name,slug,is_active,created_at,updated_at
  from public.commerce_preview_categories
  order by id;

  insert into public.commerce_subcategories(
    id,category_id,name,slug,is_active,created_at,updated_at
  )
  select id,category_id,name,slug,is_active,created_at,updated_at
  from public.commerce_preview_subcategories
  order by id;

  insert into public.commerce_products(
    id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
  )
  select id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
  from public.commerce_preview_products
  order by id;

  insert into public.commerce_product_skus(
    id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
  )
  select id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
  from public.commerce_preview_product_skus
  order by id;

  insert into public.commerce_listings(
    id,marketplace_id,external_listing_id,canonical_url,source_url,title,listing_status,sales_status,
    video_status,observed_year,source,last_checked_at,raw_metadata,created_at,updated_at
  )
  select id,marketplace_id,external_listing_id,canonical_url,source_url,title,listing_status,sales_status,
         video_status,observed_year,source,last_checked_at,raw_metadata,created_at,updated_at
  from public.commerce_preview_listings
  order by id;

  insert into public.commerce_listing_products(
    id,listing_id,product_id,product_sku_id,platform_sku,variation_id,variation_name,relation_status,created_at,updated_at
  )
  select id,listing_id,product_id,product_sku_id,platform_sku,variation_id,variation_name,relation_status,created_at,updated_at
  from public.commerce_preview_listing_products
  order by id;

  insert into public.commerce_source_files(
    id,source_code,source_name,source_kind,marketplace_code,account_code,source_filename,source_sha256,
    source_modified_at,row_count,metadata,imported_at,mime_type,byte_size,source_blob
  )
  select id,source_code,source_name,source_kind,marketplace_code,account_code,source_filename,source_sha256,
         source_modified_at,row_count,metadata,imported_at,mime_type,byte_size,source_blob
  from public.commerce_preview_source_files
  order by id;

  insert into public.commerce_source_rows(
    id,source_file_id,sheet_name,row_number,is_header,original_payload,normalized_payload,
    matched_product_id,matched_listing_id,resolution_status,notes,imported_at
  )
  select id,source_file_id,sheet_name,row_number,is_header,original_payload,normalized_payload,
         matched_product_id,matched_listing_id,resolution_status,notes,imported_at
  from public.commerce_preview_source_rows
  order by id;

  perform setval(pg_get_serial_sequence('public.commerce_categories','id'),
                 coalesce((select max(id) from public.commerce_categories),1),
                 exists(select 1 from public.commerce_categories));
  perform setval(pg_get_serial_sequence('public.commerce_subcategories','id'),
                 coalesce((select max(id) from public.commerce_subcategories),1),
                 exists(select 1 from public.commerce_subcategories));
  perform setval(pg_get_serial_sequence('public.commerce_products','id'),
                 coalesce((select max(id) from public.commerce_products),1),
                 exists(select 1 from public.commerce_products));
  perform setval(pg_get_serial_sequence('public.commerce_product_skus','id'),
                 coalesce((select max(id) from public.commerce_product_skus),1),
                 exists(select 1 from public.commerce_product_skus));
  perform setval(pg_get_serial_sequence('public.commerce_listings','id'),
                 coalesce((select max(id) from public.commerce_listings),1),
                 exists(select 1 from public.commerce_listings));
  perform setval(pg_get_serial_sequence('public.commerce_listing_products','id'),
                 coalesce((select max(id) from public.commerce_listing_products),1),
                 exists(select 1 from public.commerce_listing_products));
  perform setval(pg_get_serial_sequence('public.commerce_source_files','id'),
                 coalesce((select max(id) from public.commerce_source_files),1),
                 exists(select 1 from public.commerce_source_files));
  perform setval(pg_get_serial_sequence('public.commerce_source_rows','id'),
                 coalesce((select max(id) from public.commerce_source_rows),1),
                 exists(select 1 from public.commerce_source_rows));

  select count(*) into v_bad
  from public.commerce_catalog_audit_v3()
  where severity in ('BLOCKER','REVIEW','WARN')
    and violations > 0;

  if v_bad <> 0 then
    raise exception using errcode='P0001', message='live_catalog_audit_failed';
  end if;

  return jsonb_build_object(
    'status','PROMOTED',
    'operator',nullif(btrim(coalesce(p_operator,'')),''),
    'products',(select count(*) from public.commerce_products),
    'skus',(select count(*) from public.commerce_product_skus),
    'listings',(select count(*) from public.commerce_listings),
    'links',(select count(*) from public.commerce_listing_products),
    'categories',(select count(*) from public.commerce_categories),
    'source_files',(select count(*) from public.commerce_source_files),
    'source_rows',(select count(*) from public.commerce_source_rows),
    'promoted_at',now()
  );
end;
$$;

revoke all on function public.commerce_promote_preview_catalog_v1(bigint,bigint,bigint,bigint,bigint,bigint,text)
  from public,anon,authenticated;
grant execute on function public.commerce_promote_preview_catalog_v1(bigint,bigint,bigint,bigint,bigint,bigint,text)
  to service_role;
