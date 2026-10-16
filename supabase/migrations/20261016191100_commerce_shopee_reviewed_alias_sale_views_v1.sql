-- After a reviewed alias is approved, map both daily and monthly Shopee reports
-- to the current uniquely identified variant SKU. Existing ML behavior is unchanged.
-- No inference from title and no zero-sales/ABC classification without complete coverage.
create or replace view public.commerce_current_sales_listing_daily_v1
with (security_invoker=true)
as
with base_days as (
  select distinct on(b.platform_code,d.sale_date)
    b.platform_code,d.sale_date,b.id as batch_id
  from public.commerce_sales_import_batches b
  join public.commerce_sales_import_stage_summary s
    on s.batch_id=b.id and s.period_start=s.period_end
  join public.commerce_sales_listing_daily_v1 d
    on d.batch_id=b.id and d.sale_date=s.period_start
  where b.status='COMMITTED'
  order by b.platform_code,d.sale_date,b.committed_at desc,b.id desc
), native_rows as (
  select bd.platform_code,d.sale_date,d.external_listing_id,d.sku_norm,
    d.units,d.orders_with_item,d.product_revenue
  from base_days bd join public.commerce_sales_listing_daily_v1 d
    on d.batch_id=bd.batch_id and d.sale_date=bd.sale_date
), sku_source as (
  select d.sale_date,d.sku_norm,d.units,d.orders_with_item,d.product_revenue,
    coalesce(b.snapshot_id,0) snapshot_id
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id
  where b.platform_code='SHOPEE' and b.status='COMMITTED'
), most_recent as (
  select sale_date,max(snapshot_id) snapshot_id from sku_source group by sale_date
), current_sku as (
  select s.sale_date,s.sku_norm,sum(s.units)::integer units,
    sum(s.orders_with_item)::integer orders_with_item,
    round(sum(s.product_revenue),2)::numeric(14,2) product_revenue
  from sku_source s join most_recent v
    on v.sale_date=s.sale_date and v.snapshot_id=s.snapshot_id
  group by s.sale_date,s.sku_norm
), sku_owner as (
  select source_sku_norm,canonical_sku_norm,external_listing_id
  from public.commerce_shopee_sku_owner_reviewed_v1
), matched_sku as (
  select 'SHOPEE'::text as platform_code,s.sale_date,o.external_listing_id,
    o.canonical_sku_norm as sku_norm,s.units,s.orders_with_item,s.product_revenue
  from current_sku s join sku_owner o on o.source_sku_norm=s.sku_norm
  where not exists(select 1 from native_rows n
    where n.platform_code='SHOPEE' and n.sale_date=s.sale_date)
)
select platform_code,sale_date,external_listing_id,sku_norm,
  units,orders_with_item,product_revenue from native_rows
union all
select platform_code,sale_date,external_listing_id,sku_norm,
  units,orders_with_item,product_revenue from matched_sku;
revoke all on public.commerce_current_sales_listing_daily_v1 from public,anon,authenticated;
grant select on public.commerce_current_sales_listing_daily_v1 to service_role;

create or replace function public.commerce_listing_manager_month_sku_v1(
 p_platform text default 'TODAS', p_month text default null,
 p_search text default null, p_status text default 'ALL',
 p_curve text default 'ALL', p_limit integer default 20, p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as (
 select upper(coalesce(nullif(btrim(p_platform),''),'TODAS')) platform,
 to_date(p_month||'-01','YYYY-MM-DD')::date first_day,
 upper(coalesce(nullif(btrim(p_status),''),'ALL')) selected_status,
 upper(coalesce(nullif(btrim(p_curve),''),'ALL')) selected_curve,
 nullif(btrim(coalesce(p_search,'')),'') search,
 greatest(1,least(coalesce(p_limit,20),100)) page_size,
 greatest(0,coalesce(p_offset,0)) page_offset
 where p_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
), ads as (
 select l.id,l.external_listing_id,l.title,
 coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url,
 m.code platform,m.name platform_name,l.account_code,
 case when m.code='MERCADO_LIVRE' then
 case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
 else m.code end source
 from public.commerce_listings l
 join public.commerce_marketplaces m on m.id=l.marketplace_id
 cross join input i
 where l.listing_status='ACTIVE'
 and (i.platform='TODAS' or i.platform=m.code or
 (m.code='MERCADO_LIVRE' and i.platform in ('ML_NOVO','ML_ANTIGO')
 and upper(coalesce(l.account_code,''))=case when i.platform='ML_NOVO' then 'NOVO' else 'ANTIGO' end))
), variants as (
 select a.id listing_id,a.source,lp.variation_id,
 coalesce(nullif(lp.variation_name,''),nullif(lp.platform_sku,''),'Variação sem nome') name,
 public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku,
 lp.platform_sku display_sku
 from ads a join public.commerce_listing_products lp on lp.listing_id=a.id
 where lp.relation_status<>'REMOVED' and nullif(lp.variation_id,'') is not null
), unique_owner as (
  select 'SHOPEE'::text as source,source_sku_norm as sku,
    canonical_sku_norm as canonical_sku,listing_id,variation_id
  from public.commerce_shopee_sku_owner_reviewed_v1
  where listing_id in(select id from ads)
), known as (
 select u.listing_id,u.variation_id,u.canonical_sku as sku,
 sum(r.units)::bigint units,round(sum(r.product_revenue),2)::numeric revenue
 from public.commerce_sales_rows r
 join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
 join input i on r.period_start=i.first_day
 join unique_owner u on u.source=r.platform_code
 and u.sku=public.commerce_nisti_sku_norm_v1(r.sku_norm)
 group by u.listing_id,u.variation_id,u.canonical_sku
), amounts as (
 select listing_id,sum(units)::bigint units,round(sum(revenue),2)::numeric revenue
 from known group by listing_id
), grouped_variations as (
 select v.listing_id,count(*)::int total_variations,
 jsonb_agg(jsonb_build_object('id',v.variation_id,'name',v.name,'sku',v.display_sku,
 'units',k.units,'revenue',k.revenue,'partial',true)
 order by v.name,v.variation_id) month_variations
 from variants v left join known k on k.listing_id=v.listing_id and k.variation_id=v.variation_id
 group by v.listing_id
), decorated as (
 select a.*,coalesce(m.units,0)::bigint month_linked_units,
 coalesce(m.revenue,0)::numeric month_linked_revenue,
 coalesce(v.total_variations,0)::int total_variations,
 coalesce(v.month_variations,'[]'::jsonb) month_variations
 from ads a
 left join amounts m on m.listing_id=a.id
 left join grouped_variations v on v.listing_id=a.id
), filtered as (
 select a.* from decorated a cross join input i
 where (i.search is null or a.title ilike '%'||i.search||'%' or a.external_listing_id ilike '%'||i.search||'%')
 and i.selected_curve='ALL'
 and (i.selected_status='ALL' or
 (i.selected_status='SOLD' and a.month_linked_units>0))
), page as (
 select * from filtered order by month_linked_units desc,month_linked_revenue desc,title,id
 limit (select page_size from input) offset (select page_offset from input)
), totals as (
 select count(*)::int active_ads,0::int covered_ads,0::int sold_ads,0::int zero_ads,
 count(*)::int pending_ads,
 count(*) filter(where month_linked_units>0)::int month_linked_ads,
 coalesce(sum(month_linked_units),0)::bigint month_linked_units,
 coalesce(round(sum(month_linked_revenue),2),0)::numeric month_linked_revenue,
 0::bigint units,0::numeric revenue
 from decorated
), imported as (
 select min(s.period_start) first_day,max(s.period_end) last_day,
 sum(s.net_orders)::bigint orders,sum(s.units)::bigint units,
 round(sum(s.product_revenue),2)::numeric revenue
 from public.commerce_sales_summary_rows s
 join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current
 join input i on s.period_start=i.first_day
 where s.platform_code in(select distinct source from ads)
)
select jsonb_build_object(
 'period_start',(select first_day from input),
 'period_end',(select (first_day+interval '1 month - 1 day')::date from input),
 'days',(select extract(day from(first_day+interval '1 month - 1 day'))::int from input),
 'source_kind','MONTHLY_SKU_PARTIAL','kpis',(select to_jsonb(t) from totals t),
 'total',(select count(*) from filtered),
 'imported_month',(select case when first_day is null then null else
 jsonb_build_object('period_start',first_day,'period_end',last_day,
 'orders',orders,'units',units,'revenue',revenue) end from imported),
 'items',coalesce((select jsonb_agg(jsonb_build_object(
 'id',p.id,'external_listing_id',p.external_listing_id,'title',p.title,
 'url',p.url,'source',p.source,'platform',p.platform,'platform_name',p.platform_name,
 'account',p.account_code,'curve',null,
 'units',null,'revenue',null,'ready',false,'previous_ready',false,
 'variation_data_complete',false,'total_variations',p.total_variations,
 'sold_variations',null,'zero_variations',null,'variations','[]'::jsonb,
 'month_linked_units',p.month_linked_units,
 'month_linked_revenue',p.month_linked_revenue,
 'month_variations',p.month_variations,
 'situation',case when p.month_linked_units>0 then 'PARTIAL_SOLD' else 'PENDING' end
 ) order by p.month_linked_units desc,p.month_linked_revenue desc,p.title,p.id) from page p),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_listing_manager_month_sku_v1(text,text,text,text,text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.commerce_listing_manager_month_sku_v1(text,text,text,text,text,integer,integer)
 to service_role;

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
 sum(d.units)::bigint units,round(sum(d.product_revenue),2) revenue,
 bool_or(c.platform='SHOPEE') partial
 from chosen c join public.commerce_current_sales_listing_daily_v1 d
 on d.external_listing_id=c.external_listing_id and d.platform_code=c.source
 group by date_trunc('month',d.sale_date)
), sku_owners as (
 select source_sku_norm as sku,listing_id,1 as n
 from public.commerce_shopee_sku_owner_reviewed_v1
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
 select source_sku_norm as sku,listing_id,1 as uses
 from public.commerce_shopee_sku_owner_reviewed_v1
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