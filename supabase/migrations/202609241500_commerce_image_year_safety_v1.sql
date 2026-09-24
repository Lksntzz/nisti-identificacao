begin;

create or replace function public.commerce_sku_edition_year(p_sku text)
returns integer
language sql
immutable
security invoker
set search_path=public
as $
  with value as (
    select upper(btrim(coalesce(p_sku,''))) as sku
  ),
  extracted as (
    select
      substring(sku from '20(2[4-9]|3[0-5])') as year4,
      substring(sku from '^[A-Z&]+[^0-9A-Z]*(2[4-9]|3[0-5])') as year2
    from value
  )
  select case
    when year4 is not null then 2000 + year4::integer
    when year2 is not null then 2000 + year2::integer
    else null
  end
  from extracted;
$;

create or replace function public.commerce_text_edition_year(p_text text)
returns integer
language sql
immutable
security invoker
set search_path=public
as $
  select case
    when substring(coalesce(p_text,'') from '20(2[4-9]|3[0-5])') is not null
      then 2000 + substring(coalesce(p_text,'') from '20(2[4-9]|3[0-5])')::integer
    else null
  end;
$;

create or replace function public.commerce_image_years_compatible(
  p_target_sku text,
  p_source_sku text,
  p_source_title text default null
)
returns boolean
language sql
immutable
security invoker
set search_path=public
as $
  with years as (
    select
      public.commerce_sku_edition_year(p_target_sku) as target_year,
      coalesce(
        public.commerce_text_edition_year(p_source_title),
        public.commerce_sku_edition_year(p_source_sku)
      ) as source_year,
      regexp_replace(upper(btrim(coalesce(p_target_sku,''))),'[^A-Z0-9]+','','g') as target_sku_norm,
      regexp_replace(upper(btrim(coalesce(p_source_sku,''))),'[^A-Z0-9]+','','g') as source_sku_norm
  )
  select
    target_year is null
    or coalesce(source_year=target_year,false)
    or (
      source_year is null
      and target_sku_norm<>''
      and target_sku_norm=source_sku_norm
    )
  from years;
$;

create or replace function public.commerce_list_listings_v4(
  p_search text default null,
  p_marketplace_code text default null,
  p_listing_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  listing_id bigint,
  marketplace_code text,
  marketplace_name text,
  external_listing_id text,
  canonical_url text,
  title text,
  listing_status text,
  sales_status text,
  video_status text,
  observed_year integer,
  product_count bigint,
  platform_skus text[],
  last_checked_at timestamptz,
  total_count bigint,
  cover_image_url text,
  product_image_urls jsonb,
  variation_name text,
  variation_options jsonb,
  marketplace_category text,
  snapshot_key text,
  cover_image_source text,
  fallback_product_images jsonb,
  inherited_product_images jsonb,
  inherited_source_marketplace_code text,
  inherited_source_marketplace_name text
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    l.listing_id,l.marketplace_code,l.marketplace_name,l.external_listing_id,l.canonical_url,l.title,
    l.listing_status,l.sales_status,l.video_status,l.observed_year,l.product_count,l.platform_skus,
    l.last_checked_at,l.total_count,
    coalesce(
      l.cover_image_url,
      inherited.images->0->>'image_url',
      nisti.images->0->>'image_url'
    ) as cover_image_url,
    l.product_image_urls,l.variation_name,l.variation_options,l.marketplace_category,l.snapshot_key,
    case
      when l.cover_image_url is not null then 'MARKETPLACE'
      when jsonb_array_length(coalesce(inherited.images,'[]'::jsonb)) > 0 then 'OTHER_MARKETPLACE'
      when jsonb_array_length(coalesce(nisti.images,'[]'::jsonb)) > 0 then 'NISTI_ID'
      else null
    end as cover_image_source,
    coalesce(nisti.images,'[]'::jsonb) as fallback_product_images,
    coalesce(inherited.images,'[]'::jsonb) as inherited_product_images,
    inherited.images->0->>'source_marketplace_code' as inherited_source_marketplace_code,
    inherited.images->0->>'source_marketplace_name' as inherited_source_marketplace_name
  from public.commerce_list_listings_v2(
    p_search,p_marketplace_code,p_listing_status,p_limit,p_offset
  ) l
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'product_id',x.product_id,
        'sku',x.sku,
        'variation_name',x.variation_name,
        'image_url',x.image_url,
        'source_listing_id',x.source_listing_id,
        'source_marketplace_code',x.source_marketplace_code,
        'source_marketplace_name',x.source_marketplace_name
      )
      order by x.product_id
    ) as images
    from (
      select distinct on (target.product_id)
        target.product_id,
        cps.sku,
        target.variation_name,
        src.image_url,
        src.source_listing_id,
        src.source_marketplace_code,
        src.source_marketplace_name
      from public.commerce_listing_products target
      join public.commerce_product_skus cps
        on cps.product_id=target.product_id
       and cps.sku_type='CURRENT'
       and cps.is_active=true
      join lateral (
        select
          lp2.listing_id as source_listing_id,
          m.code as source_marketplace_code,
          m.name as source_marketplace_name,
          coalesce(option_image.image_url,s.cover_image_url) as image_url,
          case when option_image.image_url is not null then 0 else 1 end as image_rank,
          s.ingested_at,
          s.id as snapshot_id
        from public.commerce_listing_products lp2
        join public.commerce_listings l2
          on l2.id=lp2.listing_id
         and l2.listing_status<>'REMOVED'
        join public.commerce_marketplaces m on m.id=l2.marketplace_id
        join lateral (
          select ms.*
          from public.commerce_marketplace_snapshots ms
          where ms.listing_id=l2.id
            and ms.match_status='MATCHED'
          order by ms.ingested_at desc,ms.id desc
          limit 1
        ) s on true
        left join lateral (
          select nullif(btrim(opt->>'image_url'),'') as image_url
          from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) opt
          where nullif(btrim(coalesce(lp2.variation_name,'')),'') is not null
            and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
              = lower(regexp_replace(btrim(coalesce(lp2.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
            and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
          limit 1
        ) option_image on true
        where lp2.product_id=target.product_id
          and lp2.relation_status<>'REMOVED'
          and lp2.listing_id<>l.listing_id
          and public.commerce_image_years_compatible(
            coalesce(nullif(btrim(target.platform_sku),''),cps.sku),
            lp2.platform_sku,
            coalesce(s.title,l2.title)
          )
          and nullif(btrim(coalesce(coalesce(option_image.image_url,s.cover_image_url),'')),'') is not null
        order by image_rank,s.ingested_at desc,s.id desc,l2.id
        limit 1
      ) src on true
      where target.listing_id=l.listing_id
        and target.relation_status<>'REMOVED'
      order by target.product_id
    ) x
  ) inherited on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'product_id',x.product_id,
        'sku',x.sku,
        'variation_name',x.variation_name,
        'source_product_id',x.source_product_id,
        'image_url','/api/images/' || x.source_product_id::text
      )
      order by x.product_id
    ) as images
    from (
      select distinct
        lp.product_id,
        cps.sku,
        lp.variation_name,
        media.source_product_id
      from public.commerce_listing_products lp
      join public.commerce_product_skus cps
        on cps.product_id=lp.product_id
       and cps.sku_type='CURRENT'
       and cps.is_active=true
      join public.commerce_product_media_links media
        on media.product_id=lp.product_id
       and media.source_kind='NISTI_ID'
       and media.source_product_id is not null
       and public.commerce_image_years_compatible(lp.platform_sku,media.matched_sku,null)
      where lp.listing_id=l.listing_id
        and lp.relation_status<>'REMOVED'
    ) x
  ) nisti on true;
$$;

create or replace function public.commerce_preview_list_listings_v4(
  p_search text default null,
  p_marketplace_code text default null,
  p_listing_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  listing_id bigint,
  marketplace_code text,
  marketplace_name text,
  external_listing_id text,
  canonical_url text,
  title text,
  listing_status text,
  sales_status text,
  video_status text,
  observed_year integer,
  product_count bigint,
  platform_skus text[],
  last_checked_at timestamptz,
  total_count bigint,
  cover_image_url text,
  product_image_urls jsonb,
  variation_name text,
  variation_options jsonb,
  marketplace_category text,
  snapshot_key text,
  cover_image_source text,
  fallback_product_images jsonb,
  inherited_product_images jsonb,
  inherited_source_marketplace_code text,
  inherited_source_marketplace_name text
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    l.listing_id,l.marketplace_code,l.marketplace_name,l.external_listing_id,l.canonical_url,l.title,
    l.listing_status,l.sales_status,l.video_status,l.observed_year,l.product_count,l.platform_skus,
    l.last_checked_at,l.total_count,
    coalesce(
      l.cover_image_url,
      inherited.images->0->>'image_url',
      nisti.images->0->>'image_url'
    ) as cover_image_url,
    l.product_image_urls,l.variation_name,l.variation_options,l.marketplace_category,l.snapshot_key,
    case
      when l.cover_image_url is not null then 'MARKETPLACE'
      when jsonb_array_length(coalesce(inherited.images,'[]'::jsonb)) > 0 then 'OTHER_MARKETPLACE'
      when jsonb_array_length(coalesce(nisti.images,'[]'::jsonb)) > 0 then 'NISTI_ID'
      else null
    end as cover_image_source,
    coalesce(nisti.images,'[]'::jsonb) as fallback_product_images,
    coalesce(inherited.images,'[]'::jsonb) as inherited_product_images,
    inherited.images->0->>'source_marketplace_code' as inherited_source_marketplace_code,
    inherited.images->0->>'source_marketplace_name' as inherited_source_marketplace_name
  from public.commerce_preview_list_listings_v2(
    p_search,p_marketplace_code,p_listing_status,p_limit,p_offset
  ) l
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'product_id',x.product_id,
        'sku',x.sku,
        'variation_name',x.variation_name,
        'image_url',x.image_url,
        'source_listing_id',x.source_listing_id,
        'source_marketplace_code',x.source_marketplace_code,
        'source_marketplace_name',x.source_marketplace_name
      )
      order by x.product_id
    ) as images
    from (
      select distinct on (target.product_id)
        target.product_id,
        cps.sku,
        target.variation_name,
        src.image_url,
        src.source_listing_id,
        src.source_marketplace_code,
        src.source_marketplace_name
      from public.commerce_preview_listing_products target
      join public.commerce_preview_product_skus cps
        on cps.product_id=target.product_id
       and cps.sku_type='CURRENT'
       and cps.is_active=true
      join lateral (
        select
          lp2.listing_id as source_listing_id,
          m.code as source_marketplace_code,
          m.name as source_marketplace_name,
          coalesce(option_image.image_url,s.cover_image_url) as image_url,
          case when option_image.image_url is not null then 0 else 1 end as image_rank,
          s.ingested_at,
          s.id as snapshot_id
        from public.commerce_preview_listing_products lp2
        join public.commerce_preview_listings l2
          on l2.id=lp2.listing_id
         and l2.listing_status<>'REMOVED'
        join public.commerce_preview_marketplaces m on m.id=l2.marketplace_id
        join lateral (
          select ms.*
          from public.commerce_preview_marketplace_snapshots ms
          where ms.listing_id=l2.id
            and ms.match_status='MATCHED'
          order by ms.ingested_at desc,ms.id desc
          limit 1
        ) s on true
        left join lateral (
          select nullif(btrim(opt->>'image_url'),'') as image_url
          from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) opt
          where nullif(btrim(coalesce(lp2.variation_name,'')),'') is not null
            and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
              = lower(regexp_replace(btrim(coalesce(lp2.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
            and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
          limit 1
        ) option_image on true
        where lp2.product_id=target.product_id
          and lp2.relation_status<>'REMOVED'
          and lp2.listing_id<>l.listing_id
          and public.commerce_image_years_compatible(
            coalesce(nullif(btrim(target.platform_sku),''),cps.sku),
            lp2.platform_sku,
            coalesce(s.title,l2.title)
          )
          and nullif(btrim(coalesce(coalesce(option_image.image_url,s.cover_image_url),'')),'') is not null
        order by image_rank,s.ingested_at desc,s.id desc,l2.id
        limit 1
      ) src on true
      where target.listing_id=l.listing_id
        and target.relation_status<>'REMOVED'
      order by target.product_id
    ) x
  ) inherited on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'product_id',x.product_id,
        'sku',x.sku,
        'variation_name',x.variation_name,
        'source_product_id',x.source_product_id,
        'image_url','/api/images/' || x.source_product_id::text
      )
      order by x.product_id
    ) as images
    from (
      select distinct
        lp.product_id,
        cps.sku,
        lp.variation_name,
        media.source_product_id
      from public.commerce_preview_listing_products lp
      join public.commerce_preview_product_skus cps
        on cps.product_id=lp.product_id
       and cps.sku_type='CURRENT'
       and cps.is_active=true
      join public.commerce_preview_product_media_links media
        on media.product_id=lp.product_id
       and media.source_kind='NISTI_ID'
       and media.source_product_id is not null
       and public.commerce_image_years_compatible(lp.platform_sku,media.matched_sku,null)
      where lp.listing_id=l.listing_id
        and lp.relation_status<>'REMOVED'
    ) x
  ) nisti on true;
$$;

create or replace function public.commerce_product_platform_detail_v2(
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
            'image_url',coalesce(
              option_image.image_url,
              snapshot.cover_image_url,
              inherited.image_url,
              case when media.source_product_id is not null then '/api/images/'||media.source_product_id::text end
            ),
            'image_source',case
              when option_image.image_url is not null then 'MARKETPLACE_VARIATION'
              when snapshot.cover_image_url is not null then 'MARKETPLACE'
              when inherited.image_url is not null then 'OTHER_MARKETPLACE'
              when media.source_product_id is not null then 'NISTI_ID'
              else null
            end,
            'image_source_marketplace_code',inherited.source_marketplace_code,
            'image_source_marketplace_name',inherited.source_marketplace_name,
            'image_source_listing_id',inherited.source_listing_id,
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
        on media.product_id=lp.product_id
       and media.source_kind='NISTI_ID'
       and public.commerce_image_years_compatible(lp.platform_sku,media.matched_sku,null)
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
      left join lateral (
        select
          coalesce(src_option.image_url,src_snapshot.cover_image_url) as image_url,
          src_marketplace.code as source_marketplace_code,
          src_marketplace.name as source_marketplace_name,
          src_listing.id as source_listing_id
        from public.commerce_listing_products src_lp
        join public.commerce_listings src_listing
          on src_listing.id=src_lp.listing_id
         and src_listing.listing_status<>'REMOVED'
        join public.commerce_marketplaces src_marketplace
          on src_marketplace.id=src_listing.marketplace_id
        join lateral (
          select s.*
          from public.commerce_marketplace_snapshots s
          where s.listing_id=src_listing.id and s.match_status='MATCHED'
          order by s.ingested_at desc,s.id desc
          limit 1
        ) src_snapshot on true
        left join lateral (
          select nullif(btrim(opt->>'image_url'),'') as image_url
          from jsonb_array_elements(coalesce(src_snapshot.variation_options,'[]'::jsonb)) opt
          where nullif(btrim(coalesce(src_lp.variation_name,'')),'') is not null
            and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
              = lower(regexp_replace(btrim(coalesce(src_lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
            and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
          limit 1
        ) src_option on true
        where src_lp.product_id=lp.product_id
          and src_lp.relation_status<>'REMOVED'
          and src_lp.listing_id<>l.id
          and public.commerce_image_years_compatible(
            lp.platform_sku,
            src_lp.platform_sku,
            coalesce(src_snapshot.title,src_listing.title)
          )
          and nullif(btrim(coalesce(coalesce(src_option.image_url,src_snapshot.cover_image_url),'')),'') is not null
        order by
          case when src_option.image_url is not null then 0 else 1 end,
          src_snapshot.ingested_at desc,
          src_snapshot.id desc,
          src_listing.id
        limit 1
      ) inherited on true
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

create or replace function public.commerce_preview_product_platform_detail_v2(
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
            'image_url',coalesce(
              option_image.image_url,
              snapshot.cover_image_url,
              inherited.image_url,
              case when media.source_product_id is not null then '/api/images/'||media.source_product_id::text end
            ),
            'image_source',case
              when option_image.image_url is not null then 'MARKETPLACE_VARIATION'
              when snapshot.cover_image_url is not null then 'MARKETPLACE'
              when inherited.image_url is not null then 'OTHER_MARKETPLACE'
              when media.source_product_id is not null then 'NISTI_ID'
              else null
            end,
            'image_source_marketplace_code',inherited.source_marketplace_code,
            'image_source_marketplace_name',inherited.source_marketplace_name,
            'image_source_listing_id',inherited.source_listing_id,
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
        on media.product_id=lp.product_id
       and media.source_kind='NISTI_ID'
       and public.commerce_image_years_compatible(lp.platform_sku,media.matched_sku,null)
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
      left join lateral (
        select
          coalesce(src_option.image_url,src_snapshot.cover_image_url) as image_url,
          src_marketplace.code as source_marketplace_code,
          src_marketplace.name as source_marketplace_name,
          src_listing.id as source_listing_id
        from public.commerce_preview_listing_products src_lp
        join public.commerce_preview_listings src_listing
          on src_listing.id=src_lp.listing_id
         and src_listing.listing_status<>'REMOVED'
        join public.commerce_preview_marketplaces src_marketplace
          on src_marketplace.id=src_listing.marketplace_id
        join lateral (
          select s.*
          from public.commerce_preview_marketplace_snapshots s
          where s.listing_id=src_listing.id and s.match_status='MATCHED'
          order by s.ingested_at desc,s.id desc
          limit 1
        ) src_snapshot on true
        left join lateral (
          select nullif(btrim(opt->>'image_url'),'') as image_url
          from jsonb_array_elements(coalesce(src_snapshot.variation_options,'[]'::jsonb)) opt
          where nullif(btrim(coalesce(src_lp.variation_name,'')),'') is not null
            and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
              = lower(regexp_replace(btrim(coalesce(src_lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
            and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
          limit 1
        ) src_option on true
        where src_lp.product_id=lp.product_id
          and src_lp.relation_status<>'REMOVED'
          and src_lp.listing_id<>l.id
          and public.commerce_image_years_compatible(
            lp.platform_sku,
            src_lp.platform_sku,
            coalesce(src_snapshot.title,src_listing.title)
          )
          and nullif(btrim(coalesce(coalesce(src_option.image_url,src_snapshot.cover_image_url),'')),'') is not null
        order by
          case when src_option.image_url is not null then 0 else 1 end,
          src_snapshot.ingested_at desc,
          src_snapshot.id desc,
          src_listing.id
        limit 1
      ) inherited on true
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

revoke all on function public.commerce_list_listings_v4(text,text,text,integer,integer)
  from public,anon,authenticated;
revoke all on function public.commerce_preview_list_listings_v4(text,text,text,integer,integer)
  from public,anon,authenticated;
revoke all on function public.commerce_product_platform_detail_v2(bigint)
  from public,anon,authenticated;
revoke all on function public.commerce_preview_product_platform_detail_v2(bigint)
  from public,anon,authenticated;

grant execute on function public.commerce_list_listings_v4(text,text,text,integer,integer) to service_role;
grant execute on function public.commerce_preview_list_listings_v4(text,text,text,integer,integer) to service_role;
grant execute on function public.commerce_product_platform_detail_v2(bigint) to service_role;
grant execute on function public.commerce_preview_product_platform_detail_v2(bigint) to service_role;

revoke all on function public.commerce_sku_edition_year(text)
  from public,anon,authenticated;
revoke all on function public.commerce_text_edition_year(text)
  from public,anon,authenticated;
revoke all on function public.commerce_image_years_compatible(text,text,text)
  from public,anon,authenticated;

grant execute on function public.commerce_sku_edition_year(text) to service_role;
grant execute on function public.commerce_text_edition_year(text) to service_role;
grant execute on function public.commerce_image_years_compatible(text,text,text) to service_role;

commit;
