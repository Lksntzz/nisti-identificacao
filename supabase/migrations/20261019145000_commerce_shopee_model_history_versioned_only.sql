-- Extend read-only model history with its attribution scope.
-- Read-only model-level sales history, never a claim that an old order
-- belonged to the current advertisement. No SKU alias or sales row is modified.
create or replace function public.commerce_shopee_model_sales_history_v1(
  p_listing_id bigint
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with eligible as (
  select l.id listing_id,l.external_listing_id,
    lp.platform_sku,public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
    and nullif(public.commerce_nisti_sku_norm_v1(lp.platform_sku),'') is not null
), keys as (
  select e.*,
    case when e.norm ~ '^AGMT(25|26|27)[A-Z0-9]{3,}(BB|BXB)$'
      then regexp_replace(regexp_replace(e.norm,
        '^AGMT(25|26|27)','AGMT'),'(BB|BXB)$','')
      else e.norm end model_key,
    (e.norm ~ '^AGMT(25|26|27)[A-Z0-9]{3,}(BB|BXB)$') flexible
  from eligible e
), unique_models as (
  select model_key,min(listing_id) listing_id
  from keys group by model_key having count(distinct listing_id)=1
), chosen as (
  select distinct k.model_key,k.flexible
  from keys k join unique_models u on u.model_key=k.model_key and u.listing_id=k.listing_id
  where k.listing_id=p_listing_id
), raw as (
  select r.period_start,public.commerce_nisti_sku_norm_v1(r.sku_norm) norm,
    r.sku, r.units,r.product_revenue
  from public.commerce_sales_rows r
  join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
  where r.platform_code='SHOPEE'
), matched as (
  select r.period_start,r.sku,r.units,r.product_revenue,c.model_key,c.flexible
  from raw r join chosen c on
    (case when c.flexible and
       r.norm ~ '^AGMT(25|26|27)[A-Z0-9]{3,}(BB|BXB)$'
      then regexp_replace(regexp_replace(r.norm,
        '^AGMT(25|26|27)','AGMT'),'(BB|BXB)$','')
      else r.norm end)=c.model_key
), periods as (
  select to_char(m.period_start,'YYYY-MM') period,
    sum(m.units)::bigint units,round(sum(m.product_revenue),2)::numeric revenue
  from matched m group by m.period_start
), sources as (
  select coalesce(jsonb_agg(distinct s.sku),'[]'::jsonb) skus
  from matched s
)
select jsonb_build_object(
  'listing_id',p_listing_id,
  'basis','PRODUCT_MODEL',
  'has_versioned_model',(select coalesce(bool_or(flexible),false) from chosen),
  'attribution','MODEL_HISTORY_NOT_AD_ID',
  'months',coalesce((select jsonb_agg(jsonb_build_object(
    'period',p.period,'units',p.units,'revenue',p.revenue,'partial',true)
    order by p.period) from periods p),'[]'::jsonb),
  'skus',(select skus from sources)
);
$fn$;
revoke all on function public.commerce_shopee_model_sales_history_v1(bigint)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_model_sales_history_v1(bigint)
  to service_role;
