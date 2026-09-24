begin;

create or replace function public.commerce_list_products_v3(
  p_search text default null,
  p_marketplace_code text default null,
  p_category_id bigint default null,
  p_internal_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  product_id bigint,
  name text,
  current_sku text,
  category_id bigint,
  category_name text,
  subcategory_id bigint,
  subcategory_name text,
  temporal_type text,
  edition_year integer,
  internal_status text,
  marketplace_count bigint,
  listing_count bigint,
  marketplace_codes text[],
  total_count bigint,
  thumbnail_url text,
  thumbnail_listing_id bigint,
  thumbnail_source text
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    p.product_id,p.name,p.current_sku,p.category_id,p.category_name,
    p.subcategory_id,p.subcategory_name,p.temporal_type,p.edition_year,
    p.internal_status,p.marketplace_count,p.listing_count,p.marketplace_codes,p.total_count,
    coalesce(
      thumb.image_url,
      case when media.source_product_id is not null then '/api/images/' || media.source_product_id::text end
    ) as thumbnail_url,
    thumb.listing_id as thumbnail_listing_id,
    case
      when thumb.image_url is not null then 'MARKETPLACE'
      when media.source_product_id is not null then 'NISTI_ID'
      else null
    end as thumbnail_source
  from public.commerce_list_products_v1(
    p_search,p_marketplace_code,p_category_id,p_internal_status,p_limit,p_offset
  ) p
  left join lateral (
    select coalesce(nullif(btrim(lp.platform_sku),''),p.current_sku) as target_sku
    from public.commerce_listing_products lp
    join public.commerce_listings l
      on l.id=lp.listing_id and l.listing_status<>'REMOVED'
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where lp.product_id=p.product_id
      and lp.relation_status<>'REMOVED'
      and nullif(btrim(coalesce(p_marketplace_code,'')),'') is not null
      and upper(m.code)=upper(btrim(p_marketplace_code))
    order by l.id
    limit 1
  ) target on true
  left join lateral (
    select
      coalesce(option_image.image_url,s.cover_image_url) as image_url,
      l.id as listing_id
    from public.commerce_marketplace_snapshots s
    join public.commerce_listing_products lp
      on lp.listing_id=s.listing_id
     and lp.product_id=p.product_id
     and lp.relation_status<>'REMOVED'
    join public.commerce_listings l
      on l.id=s.listing_id
     and l.listing_status<>'REMOVED'
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    left join lateral (
      select nullif(btrim(opt->>'image_url'),'') as image_url
      from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) opt
      where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
        and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
          = lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
        and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
      limit 1
    ) option_image on true
    where s.match_status='MATCHED'
      and nullif(btrim(coalesce(coalesce(option_image.image_url,s.cover_image_url),'')),'') is not null
      and (
        (
          nullif(btrim(coalesce(p_marketplace_code,'')),'') is not null
          and upper(m.code)=upper(btrim(p_marketplace_code))
        )
        or public.commerce_image_years_compatible(
          coalesce(target.target_sku,p.current_sku),
          lp.platform_sku,
          coalesce(s.title,l.title)
        )
      )
    order by
      case
        when nullif(btrim(coalesce(p_marketplace_code,'')),'') is not null
         and upper(m.code)=upper(btrim(p_marketplace_code)) then 0
        else 1
      end,
      case when option_image.image_url is not null then 0 else 1 end,
      s.ingested_at desc,
      s.id desc,
      l.id
    limit 1
  ) thumb on true
  left join public.commerce_product_media_links media
    on media.product_id=p.product_id
   and media.source_kind='NISTI_ID'
   and public.commerce_image_years_compatible(
     coalesce(target.target_sku,p.current_sku),
     media.matched_sku,
     null
   );
$$;

create or replace function public.commerce_preview_list_products_v3(
  p_search text default null,
  p_marketplace_code text default null,
  p_category_id bigint default null,
  p_internal_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  product_id bigint,
  name text,
  current_sku text,
  category_id bigint,
  category_name text,
  subcategory_id bigint,
  subcategory_name text,
  temporal_type text,
  edition_year integer,
  internal_status text,
  marketplace_count bigint,
  listing_count bigint,
  marketplace_codes text[],
  total_count bigint,
  thumbnail_url text,
  thumbnail_listing_id bigint,
  thumbnail_source text
)
language sql
stable
security invoker
set search_path=public
as $$
  select
    p.product_id,p.name,p.current_sku,p.category_id,p.category_name,
    p.subcategory_id,p.subcategory_name,p.temporal_type,p.edition_year,
    p.internal_status,p.marketplace_count,p.listing_count,p.marketplace_codes,p.total_count,
    coalesce(
      thumb.image_url,
      case when media.source_product_id is not null then '/api/images/' || media.source_product_id::text end
    ) as thumbnail_url,
    thumb.listing_id as thumbnail_listing_id,
    case
      when thumb.image_url is not null then 'MARKETPLACE'
      when media.source_product_id is not null then 'NISTI_ID'
      else null
    end as thumbnail_source
  from public.commerce_preview_list_products_v1(
    p_search,p_marketplace_code,p_category_id,p_internal_status,p_limit,p_offset
  ) p
  left join lateral (
    select coalesce(nullif(btrim(lp.platform_sku),''),p.current_sku) as target_sku
    from public.commerce_preview_listing_products lp
    join public.commerce_preview_listings l
      on l.id=lp.listing_id and l.listing_status<>'REMOVED'
    join public.commerce_preview_marketplaces m on m.id=l.marketplace_id
    where lp.product_id=p.product_id
      and lp.relation_status<>'REMOVED'
      and nullif(btrim(coalesce(p_marketplace_code,'')),'') is not null
      and upper(m.code)=upper(btrim(p_marketplace_code))
    order by l.id
    limit 1
  ) target on true
  left join lateral (
    select
      coalesce(option_image.image_url,s.cover_image_url) as image_url,
      l.id as listing_id
    from public.commerce_preview_marketplace_snapshots s
    join public.commerce_preview_listing_products lp
      on lp.listing_id=s.listing_id
     and lp.product_id=p.product_id
     and lp.relation_status<>'REMOVED'
    join public.commerce_preview_listings l
      on l.id=s.listing_id
     and l.listing_status<>'REMOVED'
    join public.commerce_preview_marketplaces m on m.id=l.marketplace_id
    left join lateral (
      select nullif(btrim(opt->>'image_url'),'') as image_url
      from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) opt
      where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
        and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))
          = lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
        and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
      limit 1
    ) option_image on true
    where s.match_status='MATCHED'
      and nullif(btrim(coalesce(coalesce(option_image.image_url,s.cover_image_url),'')),'') is not null
      and (
        (
          nullif(btrim(coalesce(p_marketplace_code,'')),'') is not null
          and upper(m.code)=upper(btrim(p_marketplace_code))
        )
        or public.commerce_image_years_compatible(
          coalesce(target.target_sku,p.current_sku),
          lp.platform_sku,
          coalesce(s.title,l.title)
        )
      )
    order by
      case
        when nullif(btrim(coalesce(p_marketplace_code,'')),'') is not null
         and upper(m.code)=upper(btrim(p_marketplace_code)) then 0
        else 1
      end,
      case when option_image.image_url is not null then 0 else 1 end,
      s.ingested_at desc,
      s.id desc,
      l.id
    limit 1
  ) thumb on true
  left join public.commerce_preview_product_media_links media
    on media.product_id=p.product_id
   and media.source_kind='NISTI_ID'
   and public.commerce_image_years_compatible(
     coalesce(target.target_sku,p.current_sku),
     media.matched_sku,
     null
   );
$$;

revoke all on function public.commerce_list_products_v3(text,text,bigint,text,integer,integer)
  from public,anon,authenticated;
revoke all on function public.commerce_preview_list_products_v3(text,text,bigint,text,integer,integer)
  from public,anon,authenticated;

grant execute on function public.commerce_list_products_v3(text,text,bigint,text,integer,integer)
  to service_role;
grant execute on function public.commerce_preview_list_products_v3(text,text,bigint,text,integer,integer)
  to service_role;

commit;
