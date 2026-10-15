-- Catalog is driven by active marketplace advertisements, never by Scanner synchronization.
-- Collapse independently advertised identical SKU/product identities; keep all seller IDs.
-- Multi-variation advertisements remain intact and child variations stay below their parent ID.
create or replace function public.commerce_active_product_catalog_v1(
  p_search text default null,
  p_marketplace_code text default null,
  p_limit integer default 25,
  p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with inputs as (
  select nullif(btrim(p_search),'') q,
    nullif(upper(btrim(p_marketplace_code)),'') marketplace
), active_ads as (
  select l.id listing_id,l.marketplace_id,l.account_code,l.external_listing_id,
    l.title,l.canonical_url,l.source_url,m.code marketplace_code,m.name marketplace_name
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join inputs p
  where l.listing_status='ACTIVE'
    and (p.marketplace is null or m.code=p.marketplace)
), source_summary as (
  select a.*,
    source_stats.sku_count,
    source_stats.source_sku,
    source_stats.has_variations,
    linked.product_count,
    linked.product_id as linked_product_id,
    linked.commerce_image_url
  from active_ads a
  left join lateral (
    select b.id batch_id
    from public.commerce_import_batches b
    where b.marketplace_id=a.marketplace_id
      and b.account_code is not distinct from a.account_code
      and exists (
        select 1 from public.commerce_import_rows r
        where r.batch_id=b.id
          and r.normalized_payload->>'external_listing_id'=a.external_listing_id
          and r.normalized_payload->>'source_listing_status'='ACTIVE'
      )
    order by b.created_at desc,b.id desc
    limit 1
  ) latest on true
  left join lateral (
    select count(distinct nullif(upper(btrim(r.normalized_payload->>'sku_primary')),''))::integer sku_count,
      min(nullif(upper(btrim(r.normalized_payload->>'sku_primary')),'')) source_sku,
      coalesce(bool_or(nullif(btrim(r.normalized_payload->>'source_variation_id'),'') is not null),false) has_variations
    from public.commerce_import_rows r
    where r.batch_id=latest.batch_id
      and r.normalized_payload->>'external_listing_id'=a.external_listing_id
      and r.normalized_payload->>'source_listing_status'='ACTIVE'
  ) source_stats on true
  left join lateral (
    select count(distinct nl.nisti_product_id)::integer product_count,
      min(nl.nisti_product_id) product_id,
      max(cp.reference_image_url) commerce_image_url
    from public.commerce_listing_products lp
    join public.commerce_nisti_product_links nl on nl.commerce_product_id=lp.product_id
      and nl.sync_status='SYNCED'
    left join public.commerce_products cp on cp.id=lp.product_id
    where lp.listing_id=a.listing_id and lp.relation_status<>'REMOVED'
  ) linked on true
), resolved as (
  select s.*,
    case when s.product_count=1 then s.linked_product_id
      when s.sku_count=1 and not s.has_variations and exacts.id_count=1 then exacts.product_id
      else null end nisti_product_id
  from source_summary s
  left join lateral (
    select count(*)::integer id_count,min(p.id) product_id
    from public.products p
    where s.sku_count=1 and not s.has_variations
      and upper(btrim(p.sku))=s.source_sku
  ) exacts on true
), keyed as (
  select r.*,
    p.sku nisti_sku,p.nome nisti_name,
    case when p.image_key is not null and btrim(p.image_key)<>'' then '/api/images/'||p.id::text
      else r.commerce_image_url end as image_url,
    case when r.has_variations or r.sku_count>1 then 'AD:'||r.listing_id::text
      when r.nisti_product_id is not null then 'PRODUCT:'||r.nisti_product_id::text
      when r.sku_count=1 and r.source_sku is not null then 'SKU:'||r.source_sku
      else 'AD:'||r.listing_id::text end group_key
  from resolved r
  left join public.products p on p.id=r.nisti_product_id
), group_ids as (
  select distinct k.group_key
  from keyed k cross join inputs i
  where i.q is null or k.group_key ilike '%'||i.q||'%'
    or k.title ilike '%'||i.q||'%'
    or k.external_listing_id ilike '%'||i.q||'%'
    or k.source_sku ilike '%'||i.q||'%'
    or k.nisti_sku ilike '%'||i.q||'%'
    or k.nisti_name ilike '%'||i.q||'%'
), numbered as (
  select group_key,count(*) over () total_count
  from group_ids
), page as (
  select n.* from numbered n
  join keyed k on k.group_key=n.group_key
  group by n.group_key,n.total_count
  order by min(coalesce(k.nisti_name,k.title)),n.group_key
  limit greatest(1,least(coalesce(p_limit,25),100))
  offset greatest(0,coalesce(p_offset,0))
), page_ads as (
  select k.* from keyed k
  join page p on p.group_key=k.group_key
), variation_lookup as (
  select v.* from public.commerce_catalog_listing_variations_v1(
    coalesce((select array_agg(listing_id) from page_ads),array[]::bigint[])
  ) v
), groups as (
  select a.group_key,
    min(coalesce(a.nisti_name,a.title)) as product_name,
    max(a.nisti_product_id) as product_id,
    coalesce(max(a.nisti_sku),max(a.source_sku)) as sku,
    max(a.image_url) as image_url,
    jsonb_agg(jsonb_build_object(
      'listing_id',a.listing_id,
      'external_listing_id',a.external_listing_id,
      'url',coalesce(nullif(btrim(a.canonical_url),''),nullif(btrim(a.source_url),'')),
      'title',a.title,
      'marketplace_code',a.marketplace_code,
      'marketplace_name',a.marketplace_name,
      'account_code',a.account_code,
      'platform_sku',a.source_sku,
      'variations',coalesce(v.variations,'[]'::jsonb)
    ) order by a.marketplace_code,a.account_code,a.external_listing_id) as listings
  from page_ads a
  left join variation_lookup v on v.listing_id=a.listing_id
  group by a.group_key
)
select jsonb_build_object(
  'total',coalesce((select max(total_count) from numbered),0),
  'active_ads',(select count(*) from active_ads),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'key',g.group_key,
    'product_id',g.product_id,
    'sku',g.sku,
    'product_name',g.product_name,
    'image_url',g.image_url,
    'listings',g.listings,
    'eans',coalesce((
      select jsonb_agg(pg.gtin order by case when pg.source='GS1' then 0 else 1 end,pg.id)
      from public.product_gtins pg where pg.product_id=g.product_id and pg.active
    ),'[]'::jsonb)
  ) order by g.product_name,g.group_key) from groups g),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_active_product_catalog_v1(text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.commerce_active_product_catalog_v1(text,text,integer,integer) to service_role;
