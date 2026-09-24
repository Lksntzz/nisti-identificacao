begin;

create or replace function public.commerce_list_products_v2(
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
  thumbnail_listing_id bigint
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
    thumb.thumbnail_url,thumb.listing_id
  from public.commerce_list_products_v1(
    p_search,p_marketplace_code,p_category_id,p_internal_status,p_limit,p_offset
  ) p
  left join lateral (
    select
      coalesce(option_image.image_url,s.cover_image_url) as thumbnail_url,
      s.listing_id
    from public.commerce_marketplace_snapshots s
    join public.commerce_listing_products lp
      on lp.listing_id=s.listing_id
     and lp.product_id=p.product_id
     and lp.relation_status<>'REMOVED'
    left join lateral (
      select nullif(btrim(option->>'image_url'),'') as image_url
      from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) option
      where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
        and lower(regexp_replace(btrim(coalesce(option->>'name','')),'[^a-zA-Z0-9]+','','g'))
          = lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
        and nullif(btrim(coalesce(option->>'image_url','')),'') is not null
      limit 1
    ) option_image on true
    where s.match_status='MATCHED'
      and (
        nullif(btrim(coalesce(option_image.image_url,'')),'') is not null
        or nullif(btrim(coalesce(s.cover_image_url,'')),'') is not null
      )
    order by
      case when option_image.image_url is not null then 0 else 1 end,
      s.ingested_at desc,
      s.id desc
    limit 1
  ) thumb on true;
$$;

create or replace function public.commerce_preview_list_products_v2(
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
  thumbnail_listing_id bigint
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
    thumb.thumbnail_url,thumb.listing_id
  from public.commerce_preview_list_products_v1(
    p_search,p_marketplace_code,p_category_id,p_internal_status,p_limit,p_offset
  ) p
  left join lateral (
    select
      coalesce(option_image.image_url,s.cover_image_url) as thumbnail_url,
      s.listing_id
    from public.commerce_preview_marketplace_snapshots s
    join public.commerce_preview_listing_products lp
      on lp.listing_id=s.listing_id
     and lp.product_id=p.product_id
     and lp.relation_status<>'REMOVED'
    left join lateral (
      select nullif(btrim(option->>'image_url'),'') as image_url
      from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) option
      where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
        and lower(regexp_replace(btrim(coalesce(option->>'name','')),'[^a-zA-Z0-9]+','','g'))
          = lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
        and nullif(btrim(coalesce(option->>'image_url','')),'') is not null
      limit 1
    ) option_image on true
    where s.match_status='MATCHED'
      and (
        nullif(btrim(coalesce(option_image.image_url,'')),'') is not null
        or nullif(btrim(coalesce(s.cover_image_url,'')),'') is not null
      )
    order by
      case when option_image.image_url is not null then 0 else 1 end,
      s.ingested_at desc,
      s.id desc
    limit 1
  ) thumb on true;
$$;

commit;
