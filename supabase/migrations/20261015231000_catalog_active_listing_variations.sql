-- Return the variations actually imported under each ACTIVE seller listing.
-- One parent = one listing; every distinct variation ID is kept, even when its
-- SKU is still waiting for a safe Scanner match.
create or replace function public.commerce_catalog_listing_variations_v1(p_listing_ids bigint[])
returns table(listing_id bigint, variations jsonb)
language sql
stable
security invoker
set search_path=public
as $$
with requested as (
  select l.id, l.marketplace_id, l.account_code, l.external_listing_id
  from public.commerce_listings l
  where l.id=any(coalesce(p_listing_ids,array[]::bigint[]))
    and l.listing_status='ACTIVE'
), latest_batch as (
  select distinct on (l.id)
    l.id as listing_id,
    b.id as batch_id,
    l.external_listing_id
  from requested l
  join public.commerce_import_batches b
    on b.marketplace_id=l.marketplace_id
   and b.account_code is not distinct from l.account_code
  join public.commerce_import_rows r
    on r.batch_id=b.id
   and r.normalized_payload->>'external_listing_id'=l.external_listing_id
   and r.normalized_payload->>'source_listing_status'='ACTIVE'
  order by l.id,b.created_at desc,b.id desc
), source_variations as (
  select distinct on (b.listing_id, nullif(btrim(r.normalized_payload->>'source_variation_id'),''))
    b.listing_id,
    nullif(btrim(r.normalized_payload->>'source_variation_id'),'') as variation_id,
    nullif(btrim(r.normalized_payload->>'source_variation'),'') as variation_name,
    nullif(btrim(r.normalized_payload->>'sku_primary'),'') as sku,
    r.row_number
  from latest_batch b
  join public.commerce_import_rows r
    on r.batch_id=b.batch_id
   and r.normalized_payload->>'external_listing_id'=b.external_listing_id
  where nullif(btrim(r.normalized_payload->>'source_variation_id'),'') is not null
    and r.normalized_payload->>'source_listing_status'='ACTIVE'
  order by b.listing_id,nullif(btrim(r.normalized_payload->>'source_variation_id'),''),r.row_number
)
select s.listing_id,jsonb_agg(jsonb_build_object(
    'id',s.variation_id,
    'name',coalesce(nullif(s.variation_name,'-'),'Variação '||s.variation_id),
    'sku',s.sku,
    'current_sku',matched.current_sku,
    'image_url',matched.image_url
  ) order by s.row_number,s.variation_id) as variations
from source_variations s
left join lateral (
  select p.sku as current_sku,
    case when p.image_key is not null and btrim(p.image_key)<>'' 
         then '/api/images/'||p.id::text else null end as image_url
  from public.commerce_listing_products lp
  join public.commerce_nisti_product_links nl
    on nl.commerce_product_id=lp.product_id
   and nl.sync_status='SYNCED'
  join public.products p on p.id=nl.nisti_product_id
  where lp.listing_id=s.listing_id
    and lp.variation_id=s.variation_id
    and lp.relation_status<>'REMOVED'
  order by p.id
  limit 1
) matched on true
group by s.listing_id;
$$;
revoke all on function public.commerce_catalog_listing_variations_v1(bigint[]) from public,anon,authenticated;
grant execute on function public.commerce_catalog_listing_variations_v1(bigint[]) to service_role;
