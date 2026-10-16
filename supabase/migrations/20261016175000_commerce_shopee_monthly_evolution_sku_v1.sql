-- Histórico mensal identificado por SKU único. Shopee não dispõe de ID de anúncio no Excel.
-- Valores parciais não constituem faturamento total do anúncio.
create or replace function public.commerce_listing_manager_months_v1(p_listing_id bigint)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with chosen as (
 select l.id,l.external_listing_id,m.code platform,
 case when m.code='MERCADO_LIVRE' then
 case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
 else m.code end source
 from public.commerce_listings l join public.commerce_marketplaces m on m.id=l.marketplace_id
 where l.id=p_listing_id and l.listing_status='ACTIVE'
), daily as (
 select to_char(date_trunc('month',d.sale_date),'YYYY-MM') period,
 sum(d.units)::bigint units,round(sum(d.product_revenue),2) revenue,false partial
 from chosen c join public.commerce_current_sales_listing_daily_v1 d
 on d.external_listing_id=c.external_listing_id and d.platform_code=c.source
 group by date_trunc('month',d.sale_date)
), sku_owners as (
 select public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku,
 min(l.id) listing_id,count(*) n
 from public.commerce_listing_products lp join public.commerce_listings l on l.id=lp.listing_id
 join public.commerce_marketplaces m on m.id=l.marketplace_id
 where m.code='SHOPEE' and l.listing_status='ACTIVE'
 and lp.relation_status<>'REMOVED' and nullif(lp.variation_id,'') is not null
 and nullif(public.commerce_nisti_sku_norm_v1(lp.platform_sku),'') is not null
 group by public.commerce_nisti_sku_norm_v1(lp.platform_sku)
), matched as (
 select to_char(r.period_start,'YYYY-MM') period,
 sum(r.units)::bigint units,round(sum(r.product_revenue),2) revenue,true partial
 from chosen c
 join sku_owners u on u.listing_id=c.id and u.n=1
 join public.commerce_sales_rows r on r.platform_code='SHOPEE'
 and public.commerce_nisti_sku_norm_v1(r.sku_norm)=u.sku
 join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
 where c.platform='SHOPEE'
 group by r.period_start
), months as (
 select period,units,revenue,partial from daily
 union all
 select m.period,m.units,m.revenue,m.partial from matched m
 where not exists (select 1 from daily d where d.period=m.period)
)
select jsonb_build_object('listing_id',p_listing_id,
 'months',coalesce((select jsonb_agg(jsonb_build_object(
 'period',m.period,'units',m.units,'revenue',m.revenue,'partial',m.partial)
 order by m.period) from months m),'[]'::jsonb));
$fn$;
revoke all on function public.commerce_listing_manager_months_v1(bigint)
 from public,anon,authenticated;
grant execute on function public.commerce_listing_manager_months_v1(bigint) to service_role;

create or replace function public.commerce_listing_manager_monthly_sku_v1(p_platform text default 'SHOPEE')
returns jsonb language sql stable security invoker set search_path=public as $fn$
with owners as (
 select public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku,
 count(*) uses,min(l.id) listing_id
 from public.commerce_listing_products lp
 join public.commerce_listings l on l.id=lp.listing_id
 join public.commerce_marketplaces m on m.id=l.marketplace_id
 where l.listing_status='ACTIVE' and m.code='SHOPEE'
 and lp.relation_status<>'REMOVED' and nullif(lp.variation_id,'') is not null
 and nullif(public.commerce_nisti_sku_norm_v1(lp.platform_sku),'') is not null
 group by public.commerce_nisti_sku_norm_v1(lp.platform_sku)
), months as (
 select to_char(r.period_start,'YYYY-MM') period,
 sum(r.units)::bigint units,round(sum(r.product_revenue),2) revenue
 from public.commerce_sales_rows r
 join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
 join owners o on o.sku=public.commerce_nisti_sku_norm_v1(r.sku_norm) and o.uses=1
 where upper(coalesce(p_platform,'SHOPEE'))='SHOPEE' and r.platform_code='SHOPEE'
 group by r.period_start
)
select jsonb_build_object('months',coalesce((
 select jsonb_agg(jsonb_build_object('period',period,'units',units,'revenue',revenue,
 'partial',true) order by period) from months),'[]'::jsonb),'source_kind','MONTHLY_SKU_PARTIAL');
$fn$;
revoke all on function public.commerce_listing_manager_monthly_sku_v1(text)
 from public,anon,authenticated;
grant execute on function public.commerce_listing_manager_monthly_sku_v1(text) to service_role;