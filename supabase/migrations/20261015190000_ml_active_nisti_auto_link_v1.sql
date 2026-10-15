-- The official ML export is an observation of listings, not authority for
-- creating Scanner products. Persist each ACTIVE listing, then link only uniquely
-- identifiable NISTI products. No guesswork by title or variation position.
create or replace function public.commerce_auto_link_ml_active_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch record;
  v_row record;
  v_scanner public.products%rowtype;
  v_listing_id bigint;
  v_product_id bigint;
  v_count integer;
  v_source_sku text;
  v_source_norm text;
  v_source_pattern jsonb;
  v_variation_id text;
  v_sync jsonb;
  v_status jsonb;
  v_linked integer := 0;
  v_missing integer := 0;
  v_ambiguous integer := 0;
  v_collisions integer := 0;
  v_method text;
begin
  select b.id,b.marketplace_id,b.account_code,b.status,m.code as marketplace_code
    into v_batch
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id=b.marketplace_id
  where b.id=p_batch_id for update of b;

  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode='22023';
  end if;
  if v_batch.marketplace_code<>'MERCADO_LIVRE' or not exists (
    select 1 from public.commerce_import_rows r
    where r.batch_id=p_batch_id and r.sheet_name='Anúncios'
  ) then
    return jsonb_build_object('skipped',true,'reason','not_official_ml_export');
  end if;
  if v_batch.account_code not in ('ANTIGO','NOVO')
     or v_batch.status not in ('REVIEW','PARSED','COMMITTED') then
    raise exception 'ml_auto_sync_batch_not_ready' using errcode='22023';
  end if;

  -- This RPC is idempotent and protected by per-account listing indexes.
  -- Listings without a safely matched SKU remain visible as ACTIVE.
  v_status := public.commerce_sync_import_listing_states_account_v1(p_batch_id);

  for v_row in
    select r.id,r.normalized_payload as item
    from public.commerce_import_rows r
    where r.batch_id=p_batch_id
      and r.normalized_payload->>'source_listing_status'='ACTIVE'
      and coalesce(r.normalized_payload->>'status_only','false')<>'true'
      and nullif(btrim(coalesce(r.normalized_payload->>'sku_primary','')),'') is not null
    order by r.id
  loop
    v_source_sku := btrim(v_row.item->>'sku_primary');
    v_source_norm := public.commerce_nisti_sku_norm_v1(v_source_sku);
    v_source_pattern := public.commerce_sku_pattern_v1(v_source_sku);
    v_variation_id := nullif(btrim(coalesce(v_row.item->>'source_variation_id','')),'');
    if v_source_norm is null then continue; end if;

    -- Parent rows must never be linked in addition to their child variations.
    if v_variation_id is null and exists (
      select 1 from public.commerce_import_rows child
      where child.batch_id=p_batch_id
        and child.normalized_payload->>'external_listing_id'=v_row.item->>'external_listing_id'
        and nullif(btrim(coalesce(child.normalized_payload->>'source_variation_id','')),'') is not null
    ) then continue; end if;

    -- Distinct variations sharing the same SKU are not enough to prove which
    -- cover is which. Preserve their listing but do not guess a product link.
    if v_variation_id is not null and exists (
      select 1 from public.commerce_import_rows sibling
      where sibling.batch_id=p_batch_id and sibling.id<>v_row.id
        and sibling.normalized_payload->>'external_listing_id'=v_row.item->>'external_listing_id'
        and nullif(btrim(coalesce(sibling.normalized_payload->>'source_variation_id','')),'') is not null
        and sibling.normalized_payload->>'source_variation_id'<>v_variation_id
        and public.commerce_nisti_sku_norm_v1(sibling.normalized_payload->>'sku_primary')=v_source_norm
    ) then
      v_ambiguous:=v_ambiguous+1;
      continue;
    end if;

    -- Exact normalized SKU always wins. Reject collisions instead of taking MIN.
    select count(*),min(p.id) into v_count,v_product_id
    from public.products p
    where public.commerce_nisti_sku_norm_v1(p.sku)=v_source_norm;
    v_method:='NISTI_EXACT';
    if v_count=0 and
       coalesce(v_source_pattern->>'signature','')<>'' and
       coalesce(v_source_pattern->>'finish','')<>'' and
       coalesce(v_source_pattern->>'year','') ~ '^20[0-9]{2}$' then
      -- Only an older year may follow the SAME family, cover and finish.
      -- Never infer identity from just a name, year or approximate spelling.
      select count(*),min(p.id) into v_count,v_product_id
      from public.products p
      cross join lateral public.commerce_sku_pattern_v1(p.sku) pat
      where pat->>'signature'=v_source_pattern->>'signature'
        and pat->>'finish'=v_source_pattern->>'finish'
        and coalesce(pat->>'year','') ~ '^20[0-9]{2}$'
        and (pat->>'year')::integer>(v_source_pattern->>'year')::integer;
      v_method:='NISTI_FAMILY_YEAR';
    end if;
    if v_count=0 then v_missing:=v_missing+1; continue; end if;
    if v_count<>1 then v_ambiguous:=v_ambiguous+1; continue; end if;

    select l.id into v_listing_id
    from public.commerce_listings l
    where l.marketplace_id=v_batch.marketplace_id
      and l.account_code=v_batch.account_code
      and l.external_listing_id=v_row.item->>'external_listing_id';
    if v_listing_id is null then v_missing:=v_missing+1; continue; end if;

    -- Existing variation identity may NOT be reassigned to a different
    -- product in a subsequent export.
    if v_variation_id is not null and exists (
      select 1 from public.commerce_listing_products lp
      join public.commerce_nisti_product_links nl on nl.commerce_product_id=lp.product_id
      where lp.listing_id=v_listing_id and btrim(lp.variation_id)=v_variation_id
        and nl.nisti_product_id<>v_product_id
    ) then v_collisions:=v_collisions+1; continue; end if;

    select * into v_scanner from public.products where id=v_product_id;
    v_sync := public.commerce_sync_nisti_product_v1(
      v_scanner.id,v_scanner.sku,v_scanner.nome,v_scanner.variacao,
      case when v_scanner.image_key is not null then '/api/images/'||v_scanner.id::text else null end,
      to_jsonb(v_scanner)
    );
    v_product_id := nullif(v_sync->>'commerce_product_id','')::bigint;
    if v_product_id is null then v_ambiguous:=v_ambiguous+1; continue; end if;

    -- A historical platform SKU remains attached to the listing; the master
    -- SKU is always the updated NISTI ID SKU.
    if exists (
      select 1 from public.commerce_product_skus s
      where public.commerce_nisti_sku_norm_v1(s.sku)=v_source_norm
        and s.product_id<>v_product_id
    ) then
      v_collisions:=v_collisions+1; continue;
    end if;

    if v_variation_id is not null and exists (
      select 1 from public.commerce_listing_products lp
      where lp.listing_id=v_listing_id and btrim(lp.variation_id)=v_variation_id
        and lp.product_id<>v_product_id
    ) then v_collisions:=v_collisions+1; continue; end if;

    insert into public.commerce_listing_products(
      listing_id,product_id,platform_sku,variation_id,variation_name,relation_status
    ) values (
      v_listing_id,v_product_id,v_source_sku,v_variation_id,
      nullif(btrim(coalesce(v_row.item->>'source_variation','')),''),'ACTIVE'
    ) on conflict do nothing;

    if not exists (
      select 1 from public.commerce_listing_products lp
      where lp.listing_id=v_listing_id and lp.product_id=v_product_id
        and lp.variation_id is not distinct from v_variation_id
    ) then
      v_collisions:=v_collisions+1;
      continue;
    end if;

    if public.commerce_nisti_sku_norm_v1(v_scanner.sku)<>v_source_norm
       and not exists (
         select 1 from public.commerce_product_skus s
         where public.commerce_nisti_sku_norm_v1(s.sku)=v_source_norm
       ) then
      insert into public.commerce_product_skus(
        product_id,sku,sku_type,is_active
      ) values (v_product_id,v_source_sku,'HISTORICAL',false)
      on conflict do nothing;
    end if;

    update public.commerce_import_rows r
    set matched_product_id=v_product_id,matched_listing_id=v_listing_id,
        status='MATCHED',match_method=v_method,error_code=null,match_score=100
    where r.id=v_row.id and r.status<>'COMMITTED';
    v_linked:=v_linked+1;
  end loop;

  update public.commerce_import_batches b
  set matched_count=(
    select count(*) from public.commerce_import_rows r
    where r.batch_id=p_batch_id and r.status in ('MATCHED','COMMITTED')
  )
  where b.id=p_batch_id and b.status<>'COMMITTED';

  return coalesce(v_status,'{}'::jsonb) || jsonb_build_object(
    'linked_variation_rows',v_linked,'unmatched_skus',v_missing,
    'ambiguous_skus',v_ambiguous,'protected_collisions',v_collisions);
end;
$$;

revoke all on function public.commerce_auto_link_ml_active_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_auto_link_ml_active_v1(bigint) to service_role;

-- Internal reconciliation is the existing import action; no new UI or click.
create or replace function public.commerce_reconcile_import_batch_auto_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare v_reconcile jsonb; v_auto jsonb;
begin
  v_reconcile:=public.commerce_reconcile_import_batch_account_v2(p_batch_id);
  v_auto:=public.commerce_auto_link_ml_active_v1(p_batch_id);
  return coalesce(v_reconcile,'{}'::jsonb) || jsonb_build_object('automatic_sync',v_auto);
end;
$$;
revoke all on function public.commerce_reconcile_import_batch_auto_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_reconcile_import_batch_auto_v1(bigint) to service_role;
