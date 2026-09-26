-- Repair preview listing -> product_sku references that became stale after Product Master reconciliation.
-- Only applies when there is exactly one SKU match for the same product and normalized platform SKU.

begin;

with orphan as (
  select lp.id, lp.product_id, lp.product_sku_id, lp.platform_sku
  from public.commerce_preview_listing_products lp
  left join public.commerce_preview_product_skus ps on ps.id=lp.product_sku_id
  where lp.product_sku_id is not null
    and (ps.id is null or ps.product_id is distinct from lp.product_id)
),
candidates as (
  select
    o.id as listing_product_id,
    ps.id as correct_product_sku_id,
    count(*) over(partition by o.id) as candidate_count
  from orphan o
  join public.commerce_preview_product_skus ps
    on ps.product_id=o.product_id
   and regexp_replace(upper(coalesce(ps.sku,'')),'[^A-Z0-9]+','','g')
       = regexp_replace(upper(coalesce(o.platform_sku,'')),'[^A-Z0-9]+','','g')
),
unique_candidates as (
  select listing_product_id, correct_product_sku_id
  from candidates
  where candidate_count=1
)
update public.commerce_preview_listing_products lp
set product_sku_id=u.correct_product_sku_id,
    updated_at=now()
from unique_candidates u
where lp.id=u.listing_product_id;

do $$
begin
  if exists (
    select 1
    from public.commerce_preview_listing_products lp
    left join public.commerce_preview_product_skus ps on ps.id=lp.product_sku_id
    where lp.product_sku_id is not null
      and (ps.id is null or ps.product_id is distinct from lp.product_id)
  ) then
    raise exception 'Preview still contains invalid listing_product -> product_sku references';
  end if;
end
$$;

commit;
