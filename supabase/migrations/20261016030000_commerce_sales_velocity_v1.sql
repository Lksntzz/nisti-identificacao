-- Daily seller-performance insights. Monthly summaries NEVER masquerade as 7/30/60/90 daily windows.
-- All metrics are by canonical SKU; seller IDs are presented without allocating SKU revenue to an ad.
create or replace function public.commerce_sales_velocity_v1(
  p_days integer default 30,
  p_platform text default 'TODAS',
  p_reference_month text default null,
  p_status text default 'ALL',
  p_limit integer default 15,
  p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when p_days in (7,30,60,90) then p_days else 30 end days,
    upper(coalesce(nullif(btrim(p_platform),''),'TODAS')) platform,
    upper(coalesce(nullif(btrim(p_status),''),'ALL')) selected_status,
    greatest(1,least(coalesce(p_limit,15),50)) page_size,
    greatest(0,coalesce(p_offset,0)) page_offset,
    case when p_reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      then (to_date(p_reference_month||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date
      else null end month_end
), snap as (
  select id,data_through from public.commerce_sales_snapshots
  where is_current=true order by id desc limit 1
), window_dates as (
  select p.*,
    least(coalesce(p.month_end,(now() at time zone 'America/Sao_Paulo')::date - 1),
      (now() at time zone 'America/Sao_Paulo')::date - 1) as requested_end,
    (select data_through from snap) last_imported_day
  from params p
), bounds as (
  select *,
    requested_end as current_end,
    requested_end - (days-1) as current_start,
    requested_end - days as previous_end,
    requested_end - (2*days-1) as previous_start
  from window_dates
), active_listing_count as (
  select count(*)::bigint ads
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join bounds p
  where l.listing_status='ACTIVE'
    and (p.platform='TODAS' or m.code=p.platform
      or (p.platform in ('ML_NOVO','ML_ANTIGO') and m.code='MERCADO_LIVRE'
        and upper(coalesce(l.account_code,''))=case when p.platform='ML_NOVO' then 'NOVO' else 'ANTIGO' end))
), catalog_page_count as (
  select greatest(1,ceil(ads::numeric/100)::integer) n from active_listing_count
), catalog_pages as (
  select public.commerce_active_product_catalog_v1(
    null,
    case when p.platform in ('ML_NOVO','ML_ANTIGO') then 'MERCADO_LIVRE'
      when p.platform='TODAS' then null else p.platform end,
    100,100*g.i) as payload
  from bounds p cross join catalog_page_count cp
  cross join lateral generate_series(0,cp.n-1) g(i)
), catalog_groups as (
  select g.value as product
  from catalog_pages pages
  cross join lateral jsonb_array_elements(coalesce(pages.payload->'items','[]'::jsonb)) g(value)
), catalog_skus as (
  select nullif(public.commerce_nisti_sku_norm_v1(coalesce(product->>'sku_norm',product->>'sku')),'') as sku_norm,
    product->>'product_name' product_name,product->>'image_url' image_url,
    product->'listings' ads
  from catalog_groups
  where nullif(product->>'sku','') is not null
  union all
  select nullif(public.commerce_nisti_sku_norm_v1(coalesce(v.value->>'current_sku',v.value->>'sku')),''),
    product->>'product_name',
    coalesce(nullif(v.value->>'image_url',''),nullif(product->>'image_url','')),
    jsonb_build_array(ad.value)
  from catalog_groups c
  cross join lateral jsonb_array_elements(coalesce(c.product->'listings','[]'::jsonb)) ad(value)
  cross join lateral jsonb_array_elements(coalesce(ad.value->'variations','[]'::jsonb)) v(value)
), known_products as (
  select c.sku_norm,max(c.product_name) product_name,
    max(c.image_url) image_url
  from catalog_skus c where c.sku_norm is not null
  group by c.sku_norm
), ads_per_sku as (
  select c.sku_norm,
    coalesce(jsonb_agg(distinct ad.value),'[]'::jsonb) ads
  from catalog_skus c
  cross join lateral jsonb_array_elements(coalesce(c.ads,'[]'::jsonb)) ad(value)
  where c.sku_norm is not null
  group by c.sku_norm
), summaries as (
  select sr.period_start,sr.period_end,sr.platform_code
  from public.commerce_sales_summary_rows sr
  join snap s on s.id=sr.snapshot_id
  cross join bounds b
  where sr.period_start between b.previous_start and b.current_end
    and (
      b.platform='TODAS'
      or (b.platform='MERCADO_LIVRE' and sr.platform_code in ('ML_NOVO','ML_ANTIGO'))
      or (b.platform='ML_NOVO' and sr.platform_code='ML_NOVO')
      or (b.platform='ML_ANTIGO' and sr.platform_code='ML_ANTIGO')
      or sr.platform_code=b.platform
    )
), coverage as (
  select count(distinct s.period_start) filter (
    where s.period_start between b.current_start and b.current_end
      and s.period_start=s.period_end)::int current_days,
    count(distinct s.period_start) filter (
    where s.period_start between b.previous_start and b.previous_end
      and s.period_start=s.period_end)::int previous_days,
    exists(select 1 from snap) has_snapshot
  from bounds b left join summaries s on true
  group by b.current_start,b.current_end,b.previous_start,b.previous_end
), daily_rows as (
  select public.commerce_nisti_sku_norm_v1(coalesce(nullif(r.sku,''),r.sku_primary,r.sku_norm)) sku_norm,
    r.period_start,coalesce(r.units,0)::bigint units,
    coalesce(r.product_revenue,0)::numeric revenue
  from public.commerce_sales_rows r
  join snap s on s.id=r.snapshot_id
  cross join bounds b
  where r.period_start=r.period_end
    and r.period_start between b.previous_start and b.current_end
    and (
      b.platform='TODAS'
      or (b.platform='MERCADO_LIVRE' and r.platform_code in ('ML_NOVO','ML_ANTIGO'))
      or (b.platform='ML_NOVO' and r.platform_code='ML_NOVO')
      or (b.platform='ML_ANTIGO' and r.platform_code='ML_ANTIGO')
      or r.platform_code=b.platform
    )
), sales_per_sku as (
  select r.sku_norm,
    sum(r.units) filter(where r.period_start between b.current_start and b.current_end)::bigint current_units,
    sum(r.units) filter(where r.period_start between b.previous_start and b.previous_end)::bigint previous_units,
    round(sum(r.revenue) filter(where r.period_start between b.current_start and b.current_end),2) current_revenue
  from daily_rows r cross join bounds b
  where nullif(r.sku_norm,'') is not null
  group by r.sku_norm
), populated as (
  select k.*,a.ads,
    coalesce(s.current_units,0) current_units,
    coalesce(s.previous_units,0) previous_units,
    coalesce(s.current_revenue,0) current_revenue
  from known_products k
  left join sales_per_sku s on s.sku_norm=k.sku_norm
  left join ads_per_sku a on a.sku_norm=k.sku_norm
), avg_sales as (
  select avg(current_units)::numeric mean_positive_units
  from populated where current_units>0
), classified as (
  select p.*,
    (p.current_units>0) sold,
    (p.current_units=0) no_sales,
    (p.current_units>0 and p.current_units < coalesce(a.mean_positive_units,0)) low_sales,
    (p.current_units>=3 and (
      (p.previous_units=0)
      or (p.previous_units>0 and p.current_units>=p.previous_units*1.20)
    )) growing
  from populated p cross join avg_sales a
), readiness as (
  select c.has_snapshot,
    c.current_days >= b.days as current_ready,
    c.previous_days >= b.days as previous_ready,
    c.current_days,c.previous_days,
    b.days,b.current_start,b.current_end,b.previous_start,b.previous_end,
    b.last_imported_day
  from coverage c cross join bounds b
), items as (
  select c.* from classified c cross join readiness r cross join bounds b
  where r.current_ready and (
    b.selected_status='ALL'
    or (b.selected_status='SOLD' and c.sold)
    or (b.selected_status='ZERO' and c.no_sales)
    or (b.selected_status='LOW' and c.low_sales)
    or (b.selected_status='RISING' and r.previous_ready and c.growing)
  )
), numbered as (
  select i.*,count(*) over() total_count from items i
), page as (
  select * from numbered
  order by case when (select selected_status from bounds)='ZERO' then 0 else current_units end desc,
    current_revenue desc,sku_norm
  limit (select page_size from bounds)
  offset (select page_offset from bounds)
)
select jsonb_build_object(
  'days',(select days from bounds),
  'platform',(select platform from bounds),
  'reference_month',p_reference_month,
  'current_start',(select current_start from bounds),
  'current_end',(select current_end from bounds),
  'previous_start',(select previous_start from bounds),
  'previous_end',(select previous_end from bounds),
  'data_through',(select last_imported_day from bounds),
  'has_snapshot',(select has_snapshot from readiness),
  'current_ready',(select current_ready from readiness),
  'previous_ready',(select previous_ready from readiness),
  'covered_days',(select current_days from readiness),
  'covered_previous_days',(select previous_days from readiness),
  'catalog_products',(select count(*) from known_products),
  'catalog_unidentified',(select count(*) from catalog_groups g
    where nullif(g.product->>'sku','') is null
      and not exists(select 1 from jsonb_array_elements(coalesce(g.product->'listings','[]'::jsonb)) ad,
        jsonb_array_elements(coalesce(ad.value->'variations','[]'::jsonb)) v
        where nullif(coalesce(v.value->>'current_sku',v.value->>'sku'),'') is not null)),
  'metrics',jsonb_build_object(
    'sold',case when (select current_ready from readiness) then (select count(*) from classified where sold) else null end,
    'zero',case when (select current_ready from readiness) then (select count(*) from classified where no_sales) else null end,
    'low',case when (select current_ready from readiness) then (select count(*) from classified where low_sales) else null end,
    'rising',case when (select current_ready and previous_ready from readiness) then (select count(*) from classified where growing) else null end
  ),
  'status',(select case
    when not has_snapshot then 'NO_IMPORT'
    when not current_ready then 'DAILY_DATA_REQUIRED'
    when not previous_ready then 'GROWTH_HISTORY_REQUIRED'
    else 'READY' end from readiness),
  'total',coalesce((select max(total_count) from numbered),0),
  'limit',(select page_size from bounds),
  'offset',(select page_offset from bounds),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'sku',p.sku_norm,
    'name',p.product_name,
    'image_url',p.image_url,
    'units',p.current_units,
    'previous_units',p.previous_units,
    'revenue',p.current_revenue,
    'sold',p.sold,
    'low',p.low_sales,
    'rising',case when (select previous_ready from readiness) then p.growing else null end,
    'growth_percent',case
      when (select previous_ready from readiness) and p.previous_units>0
      then round((p.current_units-p.previous_units)*100.0/p.previous_units,1)
      else null end,
    'ads',coalesce(p.ads,'[]'::jsonb)
  ) order by p.current_units desc,p.sku_norm) from page p),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_velocity_v1(integer,text,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.commerce_sales_velocity_v1(integer,text,text,text,integer,integer) to service_role;
