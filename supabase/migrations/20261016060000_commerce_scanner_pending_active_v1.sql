-- Read-only queue of every active seller SKU/variation not CONFIRMED against a NISTI Scanner product.
-- The Scanner database is not altered by this queue or the linking transaction below.
create or replace function public.commerce_scanner_pending_active_v1(
  p_search text default null,
  p_limit integer default 15,
  p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with args as (
  select nullif(btrim(p_search),'') q,
    greatest(1,least(coalesce(p_limit,15),50)) page_size,
    greatest(0,coalesce(p_offset,0)) page_offset
), active_count as (
  select count(*)::int n from public.commerce_listings where listing_status='ACTIVE'
), pages as (
  select public.commerce_active_product_catalog_v1(null,null,100,100*g.i)->'items' items
  from active_count a cross join lateral generate_series(0,greatest(0,(a.n-1)/100)) g(i)
), groups as (
  select p.value record
  from pages a cross join lateral jsonb_array_elements(coalesce(a.items,'[]'::jsonb)) p(value)
), sku_references as (
  select g.record,
    ad.value ad,
    nullif(btrim(g.record->>'sku'),'') sku,
    nullif(public.commerce_nisti_sku_norm_v1(g.record->>'sku'),'') normalized_sku,
    null::text variation_id
  from groups g
  cross join lateral jsonb_array_elements(coalesce(g.record->'listings','[]'::jsonb)) ad(value)
  where jsonb_array_length(coalesce(ad.value->'variations','[]'::jsonb))=0

  union all
  select g.record,
    ad.value ad,
    nullif(btrim(coalesce(nullif(v.value->>'sku',''),nullif(v.value->>'current_sku',''))),'') sku,
    nullif(public.commerce_nisti_sku_norm_v1(
      coalesce(nullif(v.value->>'sku',''),nullif(v.value->>'current_sku',''))),'') normalized_sku,
    nullif(btrim(v.value->>'variation_id'),'') variation_id
  from groups g
  cross join lateral jsonb_array_elements(coalesce(g.record->'listings','[]'::jsonb)) ad(value)
  cross join lateral jsonb_array_elements(coalesce(ad.value->'variations','[]'::jsonb)) v(value)
), ready as (
  select r.*,
    (r.ad->>'listing_id')::bigint listing_id,
    coalesce(r.ad->>'title',r.record->>'product_name','Anúncio sem título') name,
    exists (
      select 1
      from public.commerce_listing_products lp
      join public.commerce_nisti_product_links nl
        on nl.commerce_product_id=lp.product_id
       and nl.sync_status='SYNCED'
      join public.products p on p.id=nl.nisti_product_id
      where lp.listing_id=(r.ad->>'listing_id')::bigint
        and lp.relation_status<>'REMOVED'
        and r.normalized_sku is not null
        and public.commerce_nisti_sku_norm_v1(lp.platform_sku)=r.normalized_sku
        and public.commerce_nisti_sku_norm_v1(p.sku)=r.normalized_sku
        and (coalesce(r.variation_id,'')='' or coalesce(lp.variation_id,'')=r.variation_id)
    ) confirmed,
    (select count(*) from public.products p
     where r.normalized_sku is not null
       and public.commerce_nisti_sku_norm_v1(p.sku)=r.normalized_sku)::int scanner_matches,
    (select min(p.id) from public.products p
     where r.normalized_sku is not null
       and public.commerce_nisti_sku_norm_v1(p.sku)=r.normalized_sku) scanner_product_id
  from sku_references r
), pending as (
  select * from ready where not confirmed
  and ( (select q from args) is null
    or name ilike '%'||(select q from args)||'%'
    or sku ilike '%'||(select q from args)||'%'
    or ad->>'external_listing_id' ilike '%'||(select q from args)||'%' )
), numbered as (
  select p.*,count(*) over() total_count from pending p
), page as (
  select * from numbered
  order by name,sku,listing_id,variation_id nulls first
  limit (select page_size from args) offset (select page_offset from args)
)
select jsonb_build_object(
  'total',coalesce((select max(total_count) from numbered),0),
  'limit',(select page_size from args),
  'offset',(select page_offset from args),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'listing_id',x.listing_id,
    'external_listing_id',x.ad->>'external_listing_id',
    'marketplace',x.ad->>'marketplace_name',
    'account',x.ad->>'account_code',
    'url',x.ad->>'url',
    'title',x.name,
    'sku',x.sku,
    'sku_norm',x.normalized_sku,
    'variation_id',x.variation_id,
    'image_url',x.record->>'image_url',
    'scanner_matches',x.scanner_matches,
    'scanner_product_id',case when x.scanner_matches=1 then x.scanner_product_id else null end
  ) order by x.name,x.sku,x.listing_id,x.variation_id) from page x),'[]'::jsonb)
);
$function$;

-- Explicit human-confirmed binding. Reject absent SKU, variant ambiguity, conflicting masters,
-- duplicate Scanner SKUs, and attempts to retarget a different linked product.
create or replace function public.commerce_link_active_ad_scanner_v1(
  p_listing_id bigint,p_nisti_product_id bigint,p_sku text
) returns jsonb
language plpgsql security invoker set search_path=public
as $function$
declare
  v_product public.products%rowtype;
  v_listing public.commerce_listings%rowtype;
  v_sku_norm text;
  v_match record;
  v_variations integer;
  v_source_rows integer;
  v_current_master bigint;
  v_sku_master bigint;
  v_others integer;
  v_cps_id bigint;
  v_relation record;
begin
  if p_listing_id is null or p_listing_id<=0 or p_nisti_product_id is null or p_nisti_product_id<=0
    then raise exception 'scanner_link_bad_identifiers' using errcode='22023'; end if;
  select * into v_product from public.products where id=p_nisti_product_id for update;
  select * into v_listing from public.commerce_listings where id=p_listing_id and listing_status='ACTIVE' for update;
  if v_product.id is null or v_listing.id is null then
    raise exception 'scanner_link_product_or_active_ad_not_found' using errcode='22023';
  end if;
  v_sku_norm:=public.commerce_nisti_sku_norm_v1(p_sku);
  if v_sku_norm is null
    or v_sku_norm is distinct from public.commerce_nisti_sku_norm_v1(v_product.sku)
    then raise exception 'scanner_link_sku_mismatch' using errcode='22023'; end if;
  select count(*) into v_others from public.products p
  where public.commerce_nisti_sku_norm_v1(p.sku)=v_sku_norm;
  if v_others<>1 then
    raise exception 'scanner_link_duplicate_scanner_sku' using errcode='22023';
  end if;
  -- Require a seller-imported SKU for exactly this active listing/account; arbitrary IDs are not eligible.
  select count(distinct coalesce(nullif(btrim(r.normalized_payload->>'source_variation_id'),''),''))
    into v_variations
  from public.commerce_import_rows r
  join public.commerce_import_batches b on b.id=r.batch_id
  where b.marketplace_id=v_listing.marketplace_id
    and b.account_code is not distinct from v_listing.account_code
    and r.normalized_payload->>'external_listing_id'=v_listing.external_listing_id
    and r.normalized_payload->>'source_listing_status'='ACTIVE'
    and (public.commerce_nisti_sku_norm_v1(r.normalized_payload->>'sku_primary')=v_sku_norm
      or public.commerce_nisti_sku_norm_v1(r.normalized_payload->>'sku_secondary')=v_sku_norm);
  if v_variations<>1 then
    raise exception 'scanner_link_variation_ambiguous_or_missing' using errcode='22023';
  end if;
  select r.normalized_payload->>'source_variation_id' variation_id,
    r.normalized_payload->>'source_variation' variation_name
    into v_match
  from public.commerce_import_rows r
  join public.commerce_import_batches b on b.id=r.batch_id
  where b.marketplace_id=v_listing.marketplace_id
    and b.account_code is not distinct from v_listing.account_code
    and r.normalized_payload->>'external_listing_id'=v_listing.external_listing_id
    and r.normalized_payload->>'source_listing_status'='ACTIVE'
    and (public.commerce_nisti_sku_norm_v1(r.normalized_payload->>'sku_primary')=v_sku_norm
      or public.commerce_nisti_sku_norm_v1(r.normalized_payload->>'sku_secondary')=v_sku_norm)
  order by b.created_at desc,b.id desc,r.id desc limit 1;
  -- Enforce one Scanner-to-Commerce master owner, and one SKU-to-master identity.
  select commerce_product_id into v_current_master
  from public.commerce_nisti_product_links
  where nisti_product_id=p_nisti_product_id and sync_status='SYNCED'
  for update;
  select ps.product_id into v_sku_master
  from public.commerce_product_skus ps
  where public.commerce_nisti_sku_norm_v1(ps.sku)=v_sku_norm
  order by ps.id limit 1;
  if v_current_master is not null and v_sku_master is not null and v_current_master<>v_sku_master then
    raise exception 'scanner_link_master_conflict' using errcode='23505';
  end if;
  v_current_master:=coalesce(v_current_master,v_sku_master);
  if v_current_master is null then
    insert into public.commerce_products(name,temporal_type,internal_status,notes)
    values(coalesce(nullif(btrim(v_product.nome),''),v_product.sku),
      'UNCLASSIFIED','DRAFT','Criado ao confirmar vínculo com produto Scanner existente.')
    returning id into v_current_master;
  end if;
  -- Avoid overwriting any active association for a variation belonging to another product.
  for v_relation in
    select lp.id,lp.product_id,lp.variation_id,lp.platform_sku from public.commerce_listing_products lp
    where lp.listing_id=p_listing_id and lp.relation_status<>'REMOVED'
      and (
        (coalesce(nullif(btrim(v_match.variation_id),''),'')<>''
          and coalesce(lp.variation_id,'')=v_match.variation_id)
        or (public.commerce_nisti_sku_norm_v1(lp.platform_sku)=v_sku_norm)
      )
    for update
  loop
    if v_relation.product_id<>v_current_master then
      raise exception 'scanner_link_listing_already_associated' using errcode='23505'; end if;
  end loop;
  if v_sku_master is null then
    insert into public.commerce_product_skus(product_id,sku,sku_type)
    values(v_current_master,v_product.sku,
      case when exists(select 1 from public.commerce_product_skus
       where product_id=v_current_master and sku_type='CURRENT' and is_active)
       then 'ALIAS' else 'CURRENT' end);
  end if;
  insert into public.commerce_nisti_product_links(
    nisti_product_id,commerce_product_id,source_sku,source_name,source_variation,
    source_image_url,source_payload,sync_status,last_synced_at,created_at,updated_at
  ) values(p_nisti_product_id,v_current_master,v_product.sku,v_product.nome,
    v_product.variacao,null,jsonb_build_object('origin','MANUAL_ACTIVE_AD_REVIEW'),
    'SYNCED',now(),now(),now())
  on conflict(nisti_product_id) do update
  set commerce_product_id=excluded.commerce_product_id,
    source_sku=excluded.source_sku,
    source_name=excluded.source_name,
    source_variation=excluded.source_variation,
    sync_status='SYNCED',last_error=null,last_synced_at=now(),updated_at=now();
  -- Link the exact listing variation. The source platform SKU remains unchanged.
  if not exists(
    select 1 from public.commerce_listing_products lp
    where lp.listing_id=p_listing_id and lp.product_id=v_current_master
      and lp.relation_status<>'REMOVED'
      and public.commerce_nisti_sku_norm_v1(lp.platform_sku)=v_sku_norm
      and coalesce(lp.variation_id,'')=coalesce(nullif(btrim(v_match.variation_id),''),'')
  ) then
    select id into v_cps_id from public.commerce_product_skus
    where product_id=v_current_master and public.commerce_nisti_sku_norm_v1(sku)=v_sku_norm limit 1;
    insert into public.commerce_listing_products(
      listing_id,product_id,product_sku_id,platform_sku,variation_id,variation_name,relation_status
    ) values(p_listing_id,v_current_master,v_cps_id,v_product.sku,
      nullif(btrim(v_match.variation_id),''),nullif(btrim(v_match.variation_name),''),
      'ACTIVE');
  end if;
  return jsonb_build_object('status','LINKED','listing_id',p_listing_id,
    'nisti_product_id',p_nisti_product_id,'commerce_product_id',v_current_master,'sku',v_product.sku);
end;
$function$;
revoke all on function public.commerce_scanner_pending_active_v1(text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_scanner_pending_active_v1(text,integer,integer) to service_role;
revoke all on function public.commerce_link_active_ad_scanner_v1(bigint,bigint,text)
  from public,anon,authenticated;
grant execute on function public.commerce_link_active_ad_scanner_v1(bigint,bigint,text) to service_role;
