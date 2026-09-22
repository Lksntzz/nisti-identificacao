begin;

create or replace function public.commerce_dashboard_v1()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with product_platform_counts as (
    select
      p.id as product_id,
      count(distinct l.marketplace_id) filter (
        where lp.relation_status <> 'REMOVED'
          and l.listing_status <> 'REMOVED'
      ) as marketplace_count
    from public.commerce_products p
    left join public.commerce_listing_products lp on lp.product_id = p.id
    left join public.commerce_listings l on l.id = lp.listing_id
    group by p.id
  ), marketplace_totals as (
    select
      m.code,
      count(distinct lp.product_id) filter (
        where lp.relation_status <> 'REMOVED'
          and l.listing_status <> 'REMOVED'
      ) as product_count,
      count(distinct l.id) filter (where l.listing_status <> 'REMOVED') as listing_count
    from public.commerce_marketplaces m
    left join public.commerce_listings l on l.marketplace_id = m.id
    left join public.commerce_listing_products lp on lp.listing_id = l.id
    where m.is_active = true
    group by m.id, m.code
  )
  select jsonb_build_object(
    'products', (select count(*) from public.commerce_products),
    'active_products', (select count(*) from public.commerce_products where internal_status = 'ACTIVE'),
    'listings', (select count(*) from public.commerce_listings),
    'active_listings', (select count(*) from public.commerce_listings where listing_status = 'ACTIVE'),
    'marketplaces', (select count(*) from public.commerce_marketplaces where is_active = true),
    'multi_platform_products', (select count(*) from product_platform_counts where marketplace_count > 1),
    'single_platform_products', (select count(*) from product_platform_counts where marketplace_count = 1),
    'products_without_listing', (select count(*) from product_platform_counts where marketplace_count = 0),
    'imports_pending', (
      select count(*) from public.commerce_import_batches
      where status in ('UPLOADED', 'PARSED', 'REVIEW')
    ),
    'update_items_pending', (
      select count(*) from public.commerce_update_items
      where overall_status in ('NOT_CHECKED', 'NEEDS_UPDATE', 'IN_PROGRESS', 'BLOCKED')
    ),
    'by_marketplace', coalesce((
      select jsonb_object_agg(
        code,
        jsonb_build_object('products', product_count, 'listings', listing_count)
      )
      from marketplace_totals
    ), '{}'::jsonb)
  );
$$;

create or replace function public.commerce_list_products_v1(
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

create or replace function public.commerce_list_listings_v1(
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
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with aggregated as (
    select
      l.id,
      m.code as marketplace_code,
      m.name as marketplace_name,
      l.external_listing_id,
      l.canonical_url,
      l.title,
      l.listing_status,
      l.sales_status,
      l.video_status,
      l.observed_year,
      count(distinct lp.product_id) filter (where lp.relation_status <> 'REMOVED') as product_count,
      coalesce(
        array_agg(distinct lp.platform_sku order by lp.platform_sku) filter (
          where lp.platform_sku is not null and btrim(lp.platform_sku) <> '' and lp.relation_status <> 'REMOVED'
        ),
        array[]::text[]
      ) as platform_skus,
      l.last_checked_at
    from public.commerce_listings l
    join public.commerce_marketplaces m on m.id = l.marketplace_id
    left join public.commerce_listing_products lp on lp.listing_id = l.id
    where (p_listing_status is null or l.listing_status = upper(btrim(p_listing_status)))
      and (
        nullif(btrim(coalesce(p_marketplace_code, '')), '') is null
        or upper(m.code) = upper(btrim(p_marketplace_code))
      )
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or l.title ilike '%' || btrim(p_search) || '%'
        or l.external_listing_id ilike '%' || btrim(p_search) || '%'
        or l.canonical_url ilike '%' || btrim(p_search) || '%'
        or exists (
          select 1
          from public.commerce_listing_products lp_search
          where lp_search.listing_id = l.id
            and lp_search.platform_sku ilike '%' || btrim(p_search) || '%'
        )
      )
    group by l.id, m.code, m.name
  ), counted as (
    select a.*, count(*) over() as total_count
    from aggregated a
  )
  select
    c.id as listing_id,
    c.marketplace_code,
    c.marketplace_name,
    c.external_listing_id,
    c.canonical_url,
    c.title,
    c.listing_status,
    c.sales_status,
    c.video_status,
    c.observed_year,
    c.product_count,
    c.platform_skus,
    c.last_checked_at,
    c.total_count
  from counted c
  order by c.marketplace_code, lower(coalesce(c.title, '')), c.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.commerce_dashboard_v1() from public, anon, authenticated;
revoke all on function public.commerce_list_products_v1(text, text, bigint, text, integer, integer) from public, anon, authenticated;
revoke all on function public.commerce_list_listings_v1(text, text, text, integer, integer) from public, anon, authenticated;

grant execute on function public.commerce_dashboard_v1() to service_role;
grant execute on function public.commerce_list_products_v1(text, text, bigint, text, integer, integer) to service_role;
grant execute on function public.commerce_list_listings_v1(text, text, text, integer, integer) to service_role;

commit;
