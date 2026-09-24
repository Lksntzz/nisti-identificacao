begin;

create or replace function public.commerce_product_platform_detail_v1(
  p_product_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=public
as $$
declare
  v_result jsonb;
begin
  if p_product_id is null or p_product_id <= 0 then
    raise exception 'product_id_invalid' using errcode='22023';
  end if;

  select jsonb_build_object(
    'product_id',p.id,
    'name',p.name,
    'current_sku',sku.sku,
    'category_name',c.name,
    'subcategory_name',sc.name,
    'temporal_type',p.temporal_type,
    'edition_year',p.edition_year,
    'internal_status',p.internal_status,
    'marketplace_count',coalesce(platforms.marketplace_count,0),
    'listing_count',coalesce(platforms.listing_count,0),
    'marketplaces',coalesce(platforms.marketplaces,'[]'::jsonb)
  )
  into v_result
  from public.commerce_products p
  left join public.commerce_product_skus sku
    on sku.product_id=p.id and sku.sku_type='CURRENT' and sku.is_active=true
  left join public.commerce_categories c on c.id=p.category_id
  left join public.commerce_subcategories sc on sc.id=p.subcategory_id
  left join lateral (
    select
      count(*)::bigint as marketplace_count,
      sum(x.listing_count)::bigint as listing_count,
      jsonb_agg(
        jsonb_build_object(
          'code',x.code,
          'name',x.name,
          'listing_count',x.listing_count,
          'listings',x.listings
        )
        order by x.name,x.code
      ) as marketplaces
    from (
      select
        m.code,
        m.name,
        count(*)::bigint as listing_count,
        jsonb_agg(
          jsonb_build_object(
            'listing_id',l.id,
            'external_listing_id',l.external_listing_id,
            'canonical_url',l.canonical_url,
            'title',l.title,
            'listing_status',l.listing_status,
            'sales_status',l.sales_status,
            'video_status',l.video_status,
            'observed_year',l.observed_year,
            'last_checked_at',l.last_checked_at,
            'platform_sku',lp.platform_sku,
            'variation_name',lp.variation_name,
            'relation_status',lp.relation_status,
            'image_url',coalesce(option_image.image_url,snapshot.cover_image_url,
              case when media.source_product_id is not null then '/api/images/'||media.source_product_id::text end),
            'image_source',case
              when option_image.image_url is not null then 'MARKETPLACE_VARIATION'
              when snapshot.cover_image_url is not null then 'MARKETPLACE'
              when media.source_product_id is not null then 'NISTI_ID'
              else null
            end,
            'marketplace_category',snapshot.marketplace_category,
            'snapshot_key',snapshot.snapshot_key
          )
          order by l.id
        ) as listings
      from public.commerce_listing_products lp
      join public.commerce_listings l
        on l.id=lp.listing_id and l.listing_status<>'REMOVED'
      join public.commerce_marketplaces m on m.id=l.marketplace_id
      left join public.commerce_product_media_links media
        on media.product_id=lp.product_id and media.source_kind='NISTI_ID'
      left join lateral (
        select s.cover_image_url,s.variation_options,s.marketplace_category,s.snapshot_key
        from public.commerce_marketplace_snapshots s
        where s.listing_id=l.id and s.match_status='MATCHED'
        order by s.ingested_at desc,s.id desc
        limit 1
      ) snapshot on true
      left join lateral (
        select nullif(btrim(opt->>'image_url'),'') as image_url
        from jsonb_array_elements(coalesce(snapshot.variation_options,'[]'::jsonb)) opt
        where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
          and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
            = lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
          and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
        limit 1
      ) option_image on true
      where lp.product_id=p.id
        and lp.relation_status<>'REMOVED'
      group by m.id,m.code,m.name
    ) x
  ) platforms on true
  where p.id=p_product_id;

  if v_result is null then
    raise exception 'product_not_found' using errcode='22023';
  end if;

  return v_result;
end;
$$;

create or replace function public.commerce_preview_product_platform_detail_v1(
  p_product_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=public
as $$
declare
  v_result jsonb;
begin
  if p_product_id is null or p_product_id <= 0 then
    raise exception 'product_id_invalid' using errcode='22023';
  end if;

  select jsonb_build_object(
    'product_id',p.id,
    'name',p.name,
    'current_sku',sku.sku,
    'category_name',c.name,
    'subcategory_name',sc.name,
    'temporal_type',p.temporal_type,
    'edition_year',p.edition_year,
    'internal_status',p.internal_status,
    'marketplace_count',coalesce(platforms.marketplace_count,0),
    'listing_count',coalesce(platforms.listing_count,0),
    'marketplaces',coalesce(platforms.marketplaces,'[]'::jsonb)
  )
  into v_result
  from public.commerce_preview_products p
  left join public.commerce_preview_product_skus sku
    on sku.product_id=p.id and sku.sku_type='CURRENT' and sku.is_active=true
  left join public.commerce_preview_categories c on c.id=p.category_id
  left join public.commerce_preview_subcategories sc on sc.id=p.subcategory_id
  left join lateral (
    select
      count(*)::bigint as marketplace_count,
      sum(x.listing_count)::bigint as listing_count,
      jsonb_agg(
        jsonb_build_object(
          'code',x.code,
          'name',x.name,
          'listing_count',x.listing_count,
          'listings',x.listings
        )
        order by x.name,x.code
      ) as marketplaces
    from (
      select
        m.code,
        m.name,
        count(*)::bigint as listing_count,
        jsonb_agg(
          jsonb_build_object(
            'listing_id',l.id,
            'external_listing_id',l.external_listing_id,
            'canonical_url',l.canonical_url,
            'title',l.title,
            'listing_status',l.listing_status,
            'sales_status',l.sales_status,
            'video_status',l.video_status,
            'observed_year',l.observed_year,
            'last_checked_at',l.last_checked_at,
            'platform_sku',lp.platform_sku,
            'variation_name',lp.variation_name,
            'relation_status',lp.relation_status,
            'image_url',coalesce(option_image.image_url,snapshot.cover_image_url,
              case when media.source_product_id is not null then '/api/images/'||media.source_product_id::text end),
            'image_source',case
              when option_image.image_url is not null then 'MARKETPLACE_VARIATION'
              when snapshot.cover_image_url is not null then 'MARKETPLACE'
              when media.source_product_id is not null then 'NISTI_ID'
              else null
            end,
            'marketplace_category',snapshot.marketplace_category,
            'snapshot_key',snapshot.snapshot_key
          )
          order by l.id
        ) as listings
      from public.commerce_preview_listing_products lp
      join public.commerce_preview_listings l
        on l.id=lp.listing_id and l.listing_status<>'REMOVED'
      join public.commerce_preview_marketplaces m on m.id=l.marketplace_id
      left join public.commerce_preview_product_media_links media
        on media.product_id=lp.product_id and media.source_kind='NISTI_ID'
      left join lateral (
        select s.cover_image_url,s.variation_options,s.marketplace_category,s.snapshot_key
        from public.commerce_preview_marketplace_snapshots s
        where s.listing_id=l.id and s.match_status='MATCHED'
        order by s.ingested_at desc,s.id desc
        limit 1
      ) snapshot on true
      left join lateral (
        select nullif(btrim(opt->>'image_url'),'') as image_url
        from jsonb_array_elements(coalesce(snapshot.variation_options,'[]'::jsonb)) opt
        where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
          and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
            = lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
          and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
        limit 1
      ) option_image on true
      where lp.product_id=p.id
        and lp.relation_status<>'REMOVED'
      group by m.id,m.code,m.name
    ) x
  ) platforms on true
  where p.id=p_product_id;

  if v_result is null then
    raise exception 'product_not_found' using errcode='22023';
  end if;

  return v_result;
end;
$$;

revoke all on function public.commerce_product_platform_detail_v1(bigint)
  from public,anon,authenticated;
revoke all on function public.commerce_preview_product_platform_detail_v1(bigint)
  from public,anon,authenticated;
grant execute on function public.commerce_product_platform_detail_v1(bigint) to service_role;
grant execute on function public.commerce_preview_product_platform_detail_v1(bigint) to service_role;

commit;
