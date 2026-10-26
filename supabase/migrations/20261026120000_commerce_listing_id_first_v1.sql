-- O código do anúncio na plataforma (MLB… / ID Shopee) é a identidade do anúncio.
-- Se SKU ou título mudarem na plataforma, o vínculo existente com o produto NISTI é mantido
-- e a mudança fica registrada em raw_metadata; nada é trocado em silêncio.

create or replace function public.commerce_reconcile_import_batch_id_first_v1(p_batch_id bigint)
 returns jsonb language plpgsql set search_path to 'public' as $function$
declare
  v_base jsonb; v_b record; v_n integer := 0;
  v_matched integer; v_probable integer; v_new integer; v_conflict integer; v_invalid integer;
begin
  v_base := public.commerce_reconcile_import_batch_auto_v1(p_batch_id);
  select marketplace_id, account_code into v_b from public.commerce_import_batches where id = p_batch_id;

  with links as (
    select lp.*, count(*) over (partition by lp.listing_id) as link_count
    from public.commerce_listing_products lp
    where lp.relation_status in ('ACTIVE','UNKNOWN')
  ), cand as (
    select r.id as row_id, l.id as listing_id, k.product_id, k.platform_sku as old_sku,
           nullif(btrim(coalesce(r.normalized_payload->>'sku_secondary', r.normalized_payload->>'sku_primary','')),'') as new_sku
    from public.commerce_import_rows r
    join public.commerce_listings l
      on l.marketplace_id = v_b.marketplace_id
     and l.account_code is not distinct from v_b.account_code
     and btrim(l.external_listing_id) = btrim(r.normalized_payload->>'external_listing_id')
    join links k on k.listing_id = l.id
     and ( (nullif(btrim(coalesce(r.normalized_payload->>'source_variation_id','')),'') is not null
            and btrim(coalesce(k.variation_id,'')) = btrim(r.normalized_payload->>'source_variation_id'))
        or (nullif(btrim(coalesce(r.normalized_payload->>'source_variation_id','')),'') is null
            and k.link_count = 1 and k.variation_id is null) )
    where r.batch_id = p_batch_id
      and r.status in ('NEW_PRODUCT','PROBABLE','CONFLICT')
      and coalesce(r.match_method,'') not like 'USER\_%'
      and coalesce(r.normalized_payload->>'status_only','false') <> 'true'
      and nullif(btrim(coalesce(r.normalized_payload->>'external_listing_id','')),'') is not null
      and nullif(btrim(coalesce(k.platform_sku,'')),'') is not null
  )
  update public.commerce_import_rows r
  set status = 'MATCHED', matched_product_id = c.product_id, matched_listing_id = c.listing_id,
      match_method = 'LISTING_ID_EXISTING', match_score = 1, error_code = null,
      notes = concat_ws(',', nullif(r.notes,''), 'platform_sku_changed:' || c.old_sku || '>' || coalesce(c.new_sku,'?')),
      normalized_payload = r.normalized_payload || jsonb_build_object('linked_platform_sku', c.old_sku, 'platform_sku_observed', c.new_sku)
  from cand c
  where r.id = c.row_id
    and upper(btrim(coalesce(c.new_sku,''))) <> upper(btrim(c.old_sku))
    -- se o SKU novo já pertence a OUTRO produto NISTI, é conflito real: continua em revisão
    and not exists (select 1 from public.commerce_product_skus s
                    where upper(btrim(s.sku)) = upper(c.new_sku) and s.product_id <> c.product_id);
  get diagnostics v_n = row_count;

  select count(*) filter(where status='MATCHED'), count(*) filter(where status='PROBABLE'),
         count(*) filter(where status='NEW_PRODUCT'), count(*) filter(where status='CONFLICT'),
         count(*) filter(where status='INVALID')
  into v_matched, v_probable, v_new, v_conflict, v_invalid
  from public.commerce_import_rows where batch_id = p_batch_id;
  update public.commerce_import_batches
  set matched_count = v_matched, conflict_count = v_probable + v_conflict, invalid_count = v_invalid,
      status = case when v_probable + v_new + v_conflict + v_invalid > 0 then 'REVIEW' else 'PARSED' end
  where id = p_batch_id and status <> 'COMMITTED';

  return coalesce(v_base,'{}'::jsonb) || jsonb_build_object(
    'listing_id_first_rematched', v_n, 'matched', v_matched, 'probable', v_probable,
    'new_products', v_new, 'conflicts', v_conflict, 'invalid', v_invalid);
end $function$;

create or replace function public.commerce_commit_import_batch_account_v5(p_batch_id bigint)
 returns jsonb language plpgsql set search_path to 'public' as $function$
declare v_result jsonb; v_changed integer := 0;
begin
  -- Mantém o SKU já ligado ao anúncio; o SKU novo da plataforma só é registrado.
  update public.commerce_import_rows r
  set normalized_payload = (r.normalized_payload - 'sku_secondary')
      || jsonb_build_object('sku_primary', r.normalized_payload->>'linked_platform_sku')
  where r.batch_id = p_batch_id and r.status = 'MATCHED'
    and r.match_method = 'LISTING_ID_EXISTING'
    and nullif(btrim(coalesce(r.normalized_payload->>'linked_platform_sku','')),'') is not null;

  v_result := public.commerce_commit_import_batch_account_v4(p_batch_id);

  with obs as (
    select r.matched_listing_id as listing_id,
           jsonb_agg(jsonb_build_object('variation_id', r.normalized_payload->>'source_variation_id',
                                        'linked_sku', r.normalized_payload->>'linked_platform_sku',
                                        'platform_sku', r.normalized_payload->>'platform_sku_observed')) as items
    from public.commerce_import_rows r
    where r.batch_id = p_batch_id and r.status = 'COMMITTED' and r.match_method = 'LISTING_ID_EXISTING'
      and r.matched_listing_id is not null
    group by 1
  )
  update public.commerce_listings l
  set raw_metadata = coalesce(l.raw_metadata,'{}'::jsonb) || jsonb_build_object(
        'platform_sku_changes', obs.items, 'platform_sku_changes_at', now(), 'platform_sku_changes_batch', p_batch_id)
  from obs where l.id = obs.listing_id;
  get diagnostics v_changed = row_count;

  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object('listings_with_platform_sku_change', v_changed);
end $function$;

revoke all on function public.commerce_reconcile_import_batch_id_first_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_commit_import_batch_account_v5(bigint) from public, anon, authenticated;
grant execute on function public.commerce_reconcile_import_batch_id_first_v1(bigint) to service_role;
grant execute on function public.commerce_commit_import_batch_account_v5(bigint) to service_role;
