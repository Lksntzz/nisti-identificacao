begin;

create or replace function public.commerce_list_products_planning_v1(
  p_search text default null,
  p_marketplace_code text default null,
  p_category_id bigint default null,
  p_internal_status text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_presence text default 'ALL'
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
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with filtered as (
    select
      p.id,
      p.name,
      sku.sku as current_sku,
      p.category_id,
      c.name as category_name,
      p.subcategory_id,
      sc.name as subcategory_name,
      p.temporal_type,
      p.edition_year,
      p.internal_status
    from public.commerce_products p
    left join public.commerce_categories c on c.id = p.category_id
    left join public.commerce_subcategories sc on sc.id = p.subcategory_id
    left join lateral (
      select ps.sku
      from public.commerce_product_skus ps
      where ps.product_id = p.id
        and ps.sku_type = 'CURRENT'
        and ps.is_active = true
      order by ps.id desc
      limit 1
    ) sku on true
    where (p_category_id is null or p.category_id = p_category_id)
      and (p_internal_status is null or p.internal_status = upper(btrim(p_internal_status)))
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or p.name ilike '%' || btrim(p_search) || '%'
        or sku.sku ilike '%' || btrim(p_search) || '%'
        or exists (
          select 1
          from public.commerce_product_skus ps2
          where ps2.product_id = p.id
            and ps2.sku ilike '%' || btrim(p_search) || '%'
        )
      )
      and (
        nullif(btrim(coalesce(p_marketplace_code, '')), '') is null
        or exists (
          select 1
          from public.commerce_listing_products lp_filter
          join public.commerce_listings l_filter on l_filter.id = lp_filter.listing_id
          join public.commerce_marketplaces m_filter on m_filter.id = l_filter.marketplace_id
          where lp_filter.product_id = p.id
            and lp_filter.relation_status <> 'REMOVED'
            and l_filter.listing_status <> 'REMOVED'
            and upper(m_filter.code) = upper(btrim(p_marketplace_code))
        )
      )
  ), aggregated as (
    select
      f.*,
      count(distinct l.marketplace_id) filter (
        where lp.relation_status <> 'REMOVED' and l.listing_status <> 'REMOVED'
      ) as marketplace_count,
      count(distinct l.id) filter (
        where lp.relation_status <> 'REMOVED' and l.listing_status <> 'REMOVED'
      ) as listing_count,
      coalesce(
        array_agg(distinct m.code order by m.code) filter (
          where lp.relation_status <> 'REMOVED' and l.listing_status <> 'REMOVED' and m.code is not null
        ),
        array[]::text[]
      ) as marketplace_codes
    from filtered f
    left join public.commerce_listing_products lp on lp.product_id = f.id
    left join public.commerce_listings l on l.id = lp.listing_id
    left join public.commerce_marketplaces m on m.id = l.marketplace_id
    group by
      f.id,
      f.name,
      f.current_sku,
      f.category_id,
      f.category_name,
      f.subcategory_id,
      f.subcategory_name,
      f.temporal_type,
      f.edition_year,
      f.internal_status
  ), counted as (
    select a.*, count(*) over() as total_count
    from aggregated a
    where case upper(coalesce(p_presence,'ALL'))
      when 'EXCLUSIVE' then a.marketplace_count = 1
      when 'SHARED' then a.marketplace_count > 1
      else true end
  )
  select
    c.id as product_id,
    c.name,
    c.current_sku,
    c.category_id,
    c.category_name,
    c.subcategory_id,
    c.subcategory_name,
    c.temporal_type,
    c.edition_year,
    c.internal_status,
    c.marketplace_count,
    c.listing_count,
    c.marketplace_codes,
    c.total_count
  from counted c
  order by lower(c.name), c.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;


create or replace function public.commerce_list_products_planning_cards_v1(
  p_search text default null,
  p_marketplace_code text default null,
  p_category_id bigint default null,
  p_internal_status text default null,
  p_limit integer default 50,
  p_offset integer default 0,
  p_presence text default 'ALL'
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
  from public.commerce_list_products_planning_v1(
    p_search,p_marketplace_code,p_category_id,p_internal_status,p_limit,p_offset,p_presence
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


revoke all on function public.commerce_list_products_planning_v1(text,text,bigint,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_list_products_planning_v1(text,text,bigint,text,integer,integer,text) to service_role;
revoke all on function public.commerce_list_products_planning_cards_v1(text,text,bigint,text,integer,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_list_products_planning_cards_v1(text,text,bigint,text,integer,integer,text) to service_role;

commit;
