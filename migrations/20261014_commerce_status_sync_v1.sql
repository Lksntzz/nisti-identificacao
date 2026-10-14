-- Import explicit listing states independently of unresolved product/SKU matches.
-- Does not infer inactivity from absent listings.
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

