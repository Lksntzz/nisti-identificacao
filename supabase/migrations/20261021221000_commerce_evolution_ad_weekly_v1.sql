-- Lightweight, lazy-load chart for one expanded advertisement.
-- Zeros mean no sales identified in the data available, not confirmed zero
-- unless the imported date coverage is complete. Only safely owned SKUs count.
create or replace function public.commerce_evolution_ad_weekly_v1(p_listing_id bigint)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with ad as (
 select l.id,l.external_listing_id,
  case when m.code='SHOPEE' then 'SHOPEE'
    when upper(coalesce(l.account_code,''))='NOVO' then 'ML_NOVO'
    else 'ML_ANTIGO' end source
 from public.commerce_listings l join public.commerce_marketplaces m on m.id=l.marketplace_id
 where l.id=p_listing_id and l.listing_status='ACTIVE' and m.code in ('SHOPEE','MERCADO_LIVRE')
), valid_skus as (
 select public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku
 from ad a join public.commerce_listing_products lp on lp.listing_id=a.id
 where lp.relation_status<>'REMOVED'
   and nullif(lp.variation_id,'') is not null
   and nullif(btrim(lp.platform_sku),'') is not null
   and (a.source<>'SHOPEE' or exists(
     select 1 from public.commerce_shopee_sku_owner_reviewed_v1 o
     where o.listing_product_id=lp.id and o.listing_id=a.id
       and o.canonical_sku_norm=public.commerce_nisti_sku_norm_v1(lp.platform_sku)))
 group by public.commerce_nisti_sku_norm_v1(lp.platform_sku)
 having count(*)=1
), source_end as (
 select max(sale_date) as end_date
 from public.commerce_current_sales_listing_daily_v1 d join ad a on d.platform_code=a.source
), facts as materialized (
 select d.sale_date,sum(d.units)::bigint units
 from public.commerce_current_sales_listing_daily_v1 d
 join ad a on a.source=d.platform_code and d.external_listing_id=a.external_listing_id
 join valid_skus s on s.sku=public.commerce_nisti_sku_norm_v1(d.sku_norm)
 cross join source_end e
 where d.sale_date between e.end_date-89 and e.end_date
 group by d.sale_date
), weeks as (
 select n as week_no,
    e.end_date - 89 + n*7 as week_start,
    least(e.end_date,e.end_date - 89 + n*7 + 6) as week_end
 from source_end e cross join generate_series(0,12) n
 where e.end_date is not null
), series as (
 select w.week_start,w.week_end,
   coalesce(sum(f.units),0)::bigint as identified_units,
   count(f.sale_date)::int as days_with_identified_sales
 from weeks w left join facts f on f.sale_date between w.week_start and w.week_end
 group by w.week_start,w.week_end
)
select jsonb_build_object('listing_id',p_listing_id,
  'end_date',(select end_date from source_end),
  'points',coalesce((select jsonb_agg(to_jsonb(s) order by s.week_start) from series s),'[]'::jsonb),
  'scope','identified_sales_not_complete_coverage')
where exists(select 1 from ad);
$fn$;
revoke all on function public.commerce_evolution_ad_weekly_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_evolution_ad_weekly_v1(bigint) to service_role;
