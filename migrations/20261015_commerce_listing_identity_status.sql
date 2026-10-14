-- NISTI commercial catalog: explicit marketplace status; stable listing+variation identities.
-- Apply functions in dependency order, then lock the RPCs to service_role.
-- Absence from a partial import is never interpreted as deactivation.
create unique index if not exists commerce_listing_products_variation_identity_uq
on public.commerce_listing_products (listing_id, btrim(variation_id))
where variation_id is not null and btrim(variation_id) <> '';

CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_v6(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_base jsonb;
  v_review_variations integer := 0;
  v_matched integer;
  v_probable integer;
  v_new integer;
  v_conflicts integer;
  v_invalid integer;
begin
  v_base := public.commerce_reconcile_import_batch_v5(p_batch_id);
  -- The SKU may be shared by distinct marketplace variations. Never silently link a
  -- variation: preserve the pending review and its proposed candidates.
  with eligible as (
    select r.id
    from public.commerce_import_rows r
    where r.batch_id = p_batch_id and r.status = 'CONFLICT'
      and r.error_code = 'duplicate_sku_in_batch'
      and nullif(btrim(r.normalized_payload->>'source_variation_id'), '') is not null
      and nullif(btrim(r.normalized_payload->>'external_listing_id'), '') is not null
      and exists (
        select 1 from public.commerce_reconciliation_candidates c
        where c.import_row_id = r.id
      )
      and exists (
        select 1 from public.commerce_import_rows other
        where other.batch_id = r.batch_id and other.id <> r.id
          and upper(btrim(other.normalized_payload->>'sku_primary')) = upper(btrim(r.normalized_payload->>'sku_primary'))
      )
      and not exists (
        select 1 from public.commerce_import_rows other
        where other.batch_id = r.batch_id and other.id <> r.id
          and upper(btrim(other.normalized_payload->>'sku_primary')) = upper(btrim(r.normalized_payload->>'sku_primary'))
          and (coalesce(other.normalized_payload->>'external_listing_id','') <> r.normalized_payload->>'external_listing_id'
            or nullif(btrim(other.normalized_payload->>'source_variation_id'),'') is null
            or other.normalized_payload->>'source_variation_id' = r.normalized_payload->>'source_variation_id')
      )
  )
  update public.commerce_import_rows r
  set status = 'PROBABLE',
      match_method = 'VARIATION_SHARED_SKU_REVIEW',
      error_code = null,
      notes = concat_ws(',', nullif(r.notes,''), 'review_variation_identity')
  from eligible e
  where r.id = e.id;
  get diagnostics v_review_variations = row_count;
  select count(*) filter(where status='MATCHED'), count(*) filter(where status='PROBABLE'),
         count(*) filter(where status='NEW_PRODUCT'), count(*) filter(where status='CONFLICT'),
         count(*) filter(where status='INVALID')
  into v_matched,v_probable,v_new,v_conflicts,v_invalid
  from public.commerce_import_rows where batch_id=p_batch_id;
  update public.commerce_import_batches
  set status = case when v_probable+v_new+v_conflicts+v_invalid>0 then 'REVIEW' else 'PARSED' end,
      matched_count=v_matched, conflict_count=v_probable+v_conflicts,invalid_count=v_invalid
  where id=p_batch_id;
  return coalesce(v_base,'{}'::jsonb) ||
    jsonb_build_object('variation_shared_sku_needs_review',v_review_variations,
                       'matched',v_matched,'probable',v_probable,'new_products',v_new,
                       'conflicts',v_conflicts,'invalid',v_invalid);
end $function$


CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_v7(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_base jsonb; v_marked integer; v_matched integer; v_probable integer; v_new integer; v_conflicts integer; v_invalid integer;
begin
  v_base:=public.commerce_reconcile_import_batch_v6(p_batch_id);
  -- Duplicated SKUs across listings remain disputed. Distinct variations inside
  -- one listing are explicitly reviewed rather than falsely presented as identical rows.
  with eligible as (
    select r.id
    from public.commerce_import_rows r
    where r.batch_id=p_batch_id and r.status='CONFLICT'
      and r.error_code='duplicate_sku_in_batch'
      and nullif(btrim(r.normalized_payload->>'source_variation_id'),'') is not null
      and nullif(btrim(r.normalized_payload->>'external_listing_id'),'') is not null
      and exists (
        select 1 from public.commerce_import_rows sibling
        where sibling.batch_id=r.batch_id and sibling.id<>r.id
          and sibling.normalized_payload->>'external_listing_id'=r.normalized_payload->>'external_listing_id'
          and upper(btrim(sibling.normalized_payload->>'sku_primary'))=upper(btrim(r.normalized_payload->>'sku_primary'))
          and nullif(btrim(sibling.normalized_payload->>'source_variation_id'),'') is not null
          and sibling.normalized_payload->>'source_variation_id'<>r.normalized_payload->>'source_variation_id'
      )
      and not exists (
        select 1 from public.commerce_import_rows sibling
        where sibling.batch_id=r.batch_id and sibling.id<>r.id
          and sibling.normalized_payload->>'external_listing_id'=r.normalized_payload->>'external_listing_id'
          and sibling.normalized_payload->>'source_variation_id'=r.normalized_payload->>'source_variation_id'
      )
  )
  update public.commerce_import_rows r
  set status='PROBABLE',match_method='VARIATION_SKU_REVIEW',
      error_code=null,matched_product_id=null,match_score=null,
      notes=concat_ws(',',nullif(r.notes,''),'verify_cover_variation_sku')
  from eligible e where r.id=e.id;
  get diagnostics v_marked=row_count;
  select count(*) filter(where status='MATCHED'),count(*) filter(where status='PROBABLE'),
         count(*) filter(where status='NEW_PRODUCT'),count(*) filter(where status='CONFLICT'),count(*) filter(where status='INVALID')
  into v_matched,v_probable,v_new,v_conflicts,v_invalid
  from public.commerce_import_rows where batch_id=p_batch_id;
  update public.commerce_import_batches
  set matched_count=v_matched,conflict_count=v_probable+v_conflicts,invalid_count=v_invalid,
      status=case when v_probable+v_new+v_conflicts+v_invalid>0 then 'REVIEW' else 'PARSED' end
  where id=p_batch_id;
  return coalesce(v_base,'{}'::jsonb)||jsonb_build_object(
    'variation_sku_requires_review',v_marked,'matched',v_matched,'probable',v_probable,
    'new_products',v_new,'conflicts',v_conflicts,'invalid',v_invalid);
end $function$


CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_v8(p_batch_id bigint)
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


CREATE OR REPLACE FUNCTION public.commerce_commit_import_batch_v4(p_batch_id bigint)
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
  select b.id,b.marketplace_id,b.status,m.code as marketplace_code into v_batch
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id=b.marketplace_id
  where b.id=p_batch_id for update of b;
  if v_batch.id is null or v_batch.status not in ('PARSED','REVIEW') then
    raise exception 'batch_not_committable' using errcode='22023';
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

  v_result:=public.commerce_commit_import_batch_v3(p_batch_id);

  -- Restore persisted status observations as processed rows.
  update public.commerce_import_rows r set status='COMMITTED'
  where r.batch_id=p_batch_id and r.status='IGNORED'
    and r.match_method='LISTING_STATUS_ONLY'
    and r.normalized_payload->>'status_only'='true';

  -- Preserve listings without product SKUs when the official parent line
  -- explicitly identifies their state. Do not create phantom products.
  insert into public.commerce_listings(
    marketplace_id,external_listing_id,canonical_url,source_url,title,
    listing_status,sales_status,video_status,source,raw_metadata
  )
  select v_batch.marketplace_id,r.normalized_payload->>'external_listing_id',
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
  where l.marketplace_id=v_batch.marketplace_id and l.external_listing_id=latest.external_id;
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


CREATE OR REPLACE FUNCTION public.commerce_sync_import_listing_states_v1(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_batch record;
  v_created integer := 0;
  v_updated integer := 0;
  v_observations integer := 0;
begin
  select b.id,b.marketplace_id,b.status,m.code marketplace_code into v_batch
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id=b.marketplace_id
  where b.id=p_batch_id for update of b;
  if v_batch.id is null or v_batch.status not in ('REVIEW','PARSED','COMMITTED') then
    raise exception 'listing_status_batch_not_ready' using errcode='22023';
  end if;
  if v_batch.marketplace_code<>'MERCADO_LIVRE' then
    raise exception 'listing_status_source_not_supported' using errcode='22023';
  end if;
  if exists (
    select 1 from public.commerce_import_rows r
    where r.batch_id=p_batch_id and
      r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
      and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
    group by r.normalized_payload->>'external_listing_id'
    having count(distinct r.normalized_payload->>'source_listing_status')>1
  ) then
    raise exception 'listing_status_conflict_in_batch' using errcode='22023';
  end if;
  select count(distinct r.normalized_payload->>'external_listing_id')
  into v_observations
  from public.commerce_import_rows r
  where r.batch_id=p_batch_id
    and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
    and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$';
  with rows as (
    select distinct on (r.normalized_payload->>'external_listing_id')
      r.normalized_payload->>'external_listing_id' external_id,
      r.normalized_payload->>'source_listing_status' observed_status,
      nullif(btrim(r.normalized_payload->>'product_name'),'') name
    from public.commerce_import_rows r
    where r.batch_id=p_batch_id
      and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
      and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
    order by r.normalized_payload->>'external_listing_id',r.id desc
  ), inserted as (
    insert into public.commerce_listings(
      marketplace_id,external_listing_id,canonical_url,title,listing_status,
      sales_status,video_status,source,raw_metadata,last_checked_at
    )
    select v_batch.marketplace_id,rows.external_id,
      'https://produto.mercadolivre.com.br/MLB-' || substring(rows.external_id from 4),
      rows.name,rows.observed_status,'UNKNOWN','UNKNOWN','EXCEL',
      jsonb_build_object('status_source','OFFICIAL_ML_WORKBOOK','last_status_import_batch_id',p_batch_id),
      now()
    from rows
    on conflict do nothing
    returning id
  ) select count(*) into v_created from inserted;
  with rows as (
    select distinct on (r.normalized_payload->>'external_listing_id')
      r.normalized_payload->>'external_listing_id' external_id,
      r.normalized_payload->>'source_listing_status' observed_status
    from public.commerce_import_rows r
    where r.batch_id=p_batch_id
      and r.normalized_payload->>'source_listing_status' in ('ACTIVE','INACTIVE','PAUSED','REMOVED')
      and coalesce(r.normalized_payload->>'external_listing_id','') ~ '^MLB[0-9]{6,}$'
    order by r.normalized_payload->>'external_listing_id',r.id desc
  ), updated as (
    update public.commerce_listings l
      set listing_status=rows.observed_status,
          last_checked_at=now(),
          raw_metadata=coalesce(l.raw_metadata,'{}'::jsonb) ||
            jsonb_build_object('status_source','OFFICIAL_ML_WORKBOOK','last_status_import_batch_id',p_batch_id)
    from rows
    where l.marketplace_id=v_batch.marketplace_id
      and l.external_listing_id=rows.external_id
      and l.listing_status is distinct from rows.observed_status
    returning l.id
  ) select count(*) into v_updated from updated;
  return jsonb_build_object('batch_id',p_batch_id,'observed_listings',v_observations,
      'created',v_created,'status_changed',v_updated,'unchanged',greatest(v_observations-v_created-v_updated,0));
end $function$


revoke execute on function public.commerce_reconcile_import_batch_v6(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_reconcile_import_batch_v7(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_reconcile_import_batch_v8(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_commit_import_batch_v4(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_sync_import_listing_states_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_reconcile_import_batch_v6(bigint) to service_role;
grant execute on function public.commerce_reconcile_import_batch_v7(bigint) to service_role;
grant execute on function public.commerce_reconcile_import_batch_v8(bigint) to service_role;
grant execute on function public.commerce_commit_import_batch_v4(bigint) to service_role;
grant execute on function public.commerce_sync_import_listing_states_v1(bigint) to service_role;
