-- Expose each Scanner product's active EAN identifiers for its linked marketplace ads.
-- Read-only projection: the EANs remain owned by product_gtins; no new values are minted.
create or replace function public.commerce_sku_listing_groups_v1(
 p_search text default null,
 p_marketplace_code text default null,
 p_period_month date default null,
 p_limit integer default 25,
 p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with requested as (
 select nullif(btrim(p_search),'') as search,
        nullif(upper(btrim(p_marketplace_code)),'') as marketplace,
        coalesce(p_period_month,date_trunc('month',current_date)::date) as period_month
), pairs as (
  select distinct on (p.id,l.id)
    p.id product_id,p.sku,p.nome,p.variacao,p.image_key,
    l.id listing_id,l.external_listing_id,l.title listing_title,l.canonical_url,
    l.account_code,l.listing_status,
    m.code marketplace_code,m.name marketplace_name,
    lp.platform_sku,lp.variation_id,lp.variation_name
  from public.products p
  join public.commerce_nisti_product_links nl on nl.nisti_product_id=p.id
    and nl.sync_status='SYNCED'
  join public.commerce_listing_products lp on lp.product_id=nl.commerce_product_id
    and lp.relation_status<>'REMOVED'
  join public.commerce_listings l on l.id=lp.listing_id and l.listing_status='ACTIVE'
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join requested r
  where (r.marketplace is null or m.code=r.marketplace)
    and (r.search is null or p.sku ilike '%'||r.search||'%'
         or p.nome ilike '%'||r.search||'%'
         or l.external_listing_id ilike '%'||r.search||'%'
         or l.title ilike '%'||r.search||'%')
  order by p.id,l.id,lp.variation_id nulls first,lp.id
), product_ids as (
  select distinct product_id,sku,nome,variacao,image_key from pairs
), numbered as (
  select *,count(*) over () total_count
  from product_ids
), page as (
  select * from numbered order by sku,product_id
  limit greatest(1,least(coalesce(p_limit,25),100))
  offset greatest(coalesce(p_offset,0),0)
), entries as (
  select page.product_id,page.sku,page.nome,page.variacao,page.image_key,page.total_count,
  jsonb_agg(jsonb_build_object(
    'listing_id',p.listing_id,
    'external_listing_id',p.external_listing_id,
    'title',p.listing_title,
    'url',p.canonical_url,
    'marketplace_code',p.marketplace_code,
    'marketplace_name',p.marketplace_name,
    'account_code',p.account_code,
    'platform_sku',p.platform_sku,
    'variation_id',p.variation_id,
    'variation_name',p.variation_name,
    'manual_units',s.units,
    'last_entered_by',s.entered_by
  ) order by p.marketplace_code,p.account_code,p.external_listing_id) as listings
  from page
  join pairs p on p.product_id=page.product_id
  cross join requested r
  left join public.commerce_manual_listing_sales s
    on s.nisti_product_id=page.product_id and s.listing_id=p.listing_id
   and s.period_month=r.period_month
  group by page.product_id,page.sku,page.nome,page.variacao,page.image_key,page.total_count
)
select jsonb_build_object(
 'items',coalesce((
  select jsonb_agg(jsonb_build_object(
    'product_id',e.product_id,
    'sku',e.sku,
    'product_name',e.nome,
    'variation',e.variacao,
    'eans',coalesce((
      select jsonb_agg(g.gtin order by
        case when g.source='GS1' then 0 else 1 end,g.id)
      from public.product_gtins g
      where g.product_id=e.product_id and g.active=true
    ),'[]'::jsonb),
    'image_url',case when nullif(btrim(e.image_key),'') is not null
       then '/api/images/'||e.product_id::text else null end,
    'listings',e.listings
  ) order by e.sku,e.product_id)
  from entries e
 ),'[]'::jsonb),
 'total',coalesce((select max(total_count) from numbered),0),
 'period_month',(select period_month from requested)
);
$function$;
