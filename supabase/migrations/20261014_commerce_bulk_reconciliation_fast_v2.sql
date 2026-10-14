-- Avoid expensive per-new-product name suggestion cross joins in large official catalog imports.
-- Unmatched products remain for human review; never auto-link based on name.
CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_fast_v5(p_batch_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public' AS $function$
declare v_base jsonb; v_suggestions jsonb:='{}'::jsonb; v_new integer;
begin
  v_base:=public.commerce_reconcile_import_batch_v4(p_batch_id);
  select count(*) into v_new from public.commerce_import_rows
  where batch_id=p_batch_id and status='NEW_PRODUCT'
    and coalesce(match_method,'') in ('NO_MATCH','NO_MATCH_NOT_LISTED');
  -- Name-based suggestions are O(unmatched rows x all products) and timed out
  -- on the official 815-row ML workbook. Identity matching still runs for every
  -- row; existing SKU candidates and variation safety checks remain in force.
  if v_new<=12 then
    v_suggestions:=public.commerce_suggest_new_product_candidates_v1(p_batch_id);
  else
    v_suggestions:=jsonb_build_object(
      'name_suggestions_deferred',v_new,'review_required',true);
  end if;
  return coalesce(v_base,'{}'::jsonb)||coalesce(v_suggestions,'{}'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_fast_v6(p_batch_id bigint)
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
  v_base := public.commerce_reconcile_import_batch_fast_v5(p_batch_id);
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
end $function$;

CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_fast_v7(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_base jsonb; v_marked integer; v_matched integer; v_probable integer; v_new integer; v_conflicts integer; v_invalid integer;
begin
  v_base:=public.commerce_reconcile_import_batch_fast_v6(p_batch_id);
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
end $function$;

CREATE OR REPLACE FUNCTION public.commerce_reconcile_import_batch_account_v2(p_batch_id bigint)
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
 v_result := public.commerce_reconcile_import_batch_fast_v7(p_batch_id);
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
end $function$;

revoke execute on function public.commerce_reconcile_import_batch_fast_v5(bigint) from public,anon,authenticated;
grant execute on function public.commerce_reconcile_import_batch_fast_v5(bigint) to service_role;
revoke execute on function public.commerce_reconcile_import_batch_fast_v6(bigint) from public,anon,authenticated;
grant execute on function public.commerce_reconcile_import_batch_fast_v6(bigint) to service_role;
revoke execute on function public.commerce_reconcile_import_batch_fast_v7(bigint) from public,anon,authenticated;
grant execute on function public.commerce_reconcile_import_batch_fast_v7(bigint) to service_role;
revoke execute on function public.commerce_reconcile_import_batch_account_v2(bigint) from public,anon,authenticated;
grant execute on function public.commerce_reconcile_import_batch_account_v2(bigint) to service_role;
