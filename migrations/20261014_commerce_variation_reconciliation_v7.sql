-- Import reconciliation: preserve distinct marketplace variation identities.
-- Applied on Supabase before deploying the client change.
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

