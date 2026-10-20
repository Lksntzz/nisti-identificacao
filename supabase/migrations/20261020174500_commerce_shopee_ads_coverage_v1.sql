-- Read-only lookup for badge/tab visibility on the currently displayed commercial listings.
-- Only entries linked to an actual imported Shopee Ads product count.
create or replace function public.commerce_shopee_ads_coverage_v1(p_listing_ids bigint[])
returns jsonb
language sql stable security invoker set search_path=public
as $function$
select coalesce(jsonb_agg(x.listing_id order by x.listing_id),'[]'::jsonb)
from (
  select distinct r.listing_id
  from public.commerce_shopee_ads_rows_v1 r
  join public.commerce_shopee_ads_reports_v1 b on b.id=r.report_id
  join public.commerce_listings l on l.id=r.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE'
    and r.listing_id = any(p_listing_ids)
    and b.report_kind in ('GENERAL','TARGETING')
    and r.external_product_id=l.external_listing_id
) x;
$function$;
revoke all on function public.commerce_shopee_ads_coverage_v1(bigint[])
from public,anon,authenticated;
grant execute on function public.commerce_shopee_ads_coverage_v1(bigint[]) to service_role;
