-- Accurate 7/30/60/90-day sales by real marketplace listing IDs.
-- Incomplete platforms are excluded from the no-sales denominator; they are not reported as zero.
create or replace function public.commerce_sales_velocity_v2(
  p_days integer default 30, p_platform text default 'TODAS',
  p_reference_month text default null, p_status text default 'SOLD',
  p_limit integer default 15,p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with args as (
  select case when p_days in (7,30,60,90) then p_days else 30 end days,
    upper(coalesce(nullif(trim(p_platform),''),'TODAS')) platform,
    upper(coalesce(nullif(trim(p_status),''),'SOLD')) selected_status,
    case when p_reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      then (to_date(p_reference_month||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date
      else null end month_end,
    greatest(1,least(coalesce(p_limit,15),50)) page_size,
    greatest(0,coalesce(p_offset,0)) page_offset
), expected_sources as (
  select distinct case when m.code='MERCADO_LIVRE'
    then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
    else m.code end as source
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join args a
  where l.listing_status='ACTIVE'
    and (a.platform='TODAS' or a.platform=m.code
      or (m.code='MERCADO_LIVRE' and a.platform in ('ML_ANTIGO','ML_NOVO')
        and upper(coalesce(l.account_code,''))=
          case when a.platform='ML_ANTIGO' then 'ANTIGO' else 'NOVO' end))
), available_end as (
  select max(d.sale_date) data_through
  from public.commerce_current_sales_listing_daily_v1 d
  cross join args a
  where a.platform='TODAS' or d.platform_code=a.platform
    or (a.platform='MERCADO_LIVRE' and d.platform_code in ('ML_ANTIGO','ML_NOVO'))
), bounds as (
  select a.*,
    least(
      coalesce(a.month_end,(now() at time zone 'America/Sao_Paulo')::date-1),
      (now() at time zone 'America/Sao_Paulo')::date-1,
      coalesce((select data_through from available_end),(now() at time zone 'America/Sao_Paulo')::date-1)
    ) current_end,
    (select data_through from available_end) data_through
  from args a
), windows as (
  select b.*,b.current_end-b.days+1 current_start,
    b.current_end-b.days previous_end,
    b.current_end-2*b.days+1 previous_start
  from bounds b
), source_coverage as (
  select e.source,
    count(distinct s.period_start) filter(where s.period_start between w.current_start and w.current_end
      and s.period_start=s.period_end)::int current_days,
    count(distinct s.period_start) filter(where s.period_start between w.previous_start and w.previous_end
      and s.period_start=s.period_end)::int previous_days
  from expected_sources e cross join windows w
  left join public.commerce_sales_import_batches b on b.platform_code=e.source and b.status='COMMITTED'
  left join public.commerce_sales_import_stage_summary s on s.batch_id=b.id
  group by e.source
), covered_sources as (
  select sc.source,sc.current_days,sc.previous_days from source_coverage sc
  cross join windows w where sc.current_days>=w.days
), daily_sales as (
  select d.platform_code,d.sale_date,d.external_listing_id,d.sku_norm,
    d.units,d.product_revenue
  from public.commerce_current_sales_listing_daily_v1 d
  join covered_sources c on c.source=d.platform_code
  cross join windows w
  where d.sale_date between w.previous_start and w.current_end
), sales_by_sku as (
  select public.commerce_nisti_sku_norm_v1(d.sku_norm) sku_norm,
    sum(d.units) filter(where d.sale_date between w.current_start and w.current_end)::bigint current_units,
    sum(d.units) filter(where d.sale_date between w.previous_start and w.previous_end)::bigint previous_units,
    round(sum(d.product_revenue) filter(where d.sale_date between w.current_start and w.current_end),2) current_revenue
  from daily_sales d cross join windows w
  where nullif(public.commerce_nisti_sku_norm_v1(d.sku_norm),'') is not null
  group by public.commerce_nisti_sku_norm_v1(d.sku_norm)
), listing_pages as (
  select public.commerce_active_product_catalog_v1(null,
    case when w.platform in ('TODAS','ML_ANTIGO','ML_NOVO') then null
      else w.platform end,100,i.i*100)->'items' items
  from windows w
  cross join lateral generate_series(0,greatest(0,(
    select count(*)::int from public.commerce_listings where listing_status='ACTIVE')/100)) i(i)
), listings as (
  select g.value product,ad.value ad
  from listing_pages lp cross join lateral jsonb_array_elements(coalesce(lp.items,'[]'::jsonb)) g(value)
  cross join lateral jsonb_array_elements(coalesce(g.value->'listings','[]'::jsonb)) ad(value)
), catalog_skus as (
  select public.commerce_nisti_sku_norm_v1(coalesce(nullif(l.ad->>'platform_sku',''),nullif(l.product->>'sku',''))) sku_norm,
    l.product->>'product_name' name,l.product->>'image_url' image_url,l.ad,
    case when l.ad->>'marketplace_code'='MERCADO_LIVRE'
      then case upper(coalesce(l.ad->>'account_code','')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
      else l.ad->>'marketplace_code' end source
  from listings l where coalesce(jsonb_array_length(l.ad->'variations'),0)=0
  union all
  select public.commerce_nisti_sku_norm_v1(coalesce(nullif(v.value->>'current_sku',''),v.value->>'sku')),
    l.product->>'product_name',coalesce(nullif(v.value->>'image_url',''),l.product->>'image_url'),
    l.ad,
    case when l.ad->>'marketplace_code'='MERCADO_LIVRE'
      then case upper(coalesce(l.ad->>'account_code','')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
      else l.ad->>'marketplace_code' end
  from listings l cross join lateral jsonb_array_elements(coalesce(l.ad->'variations','[]'::jsonb)) v(value)
), catalog_known as (
  select c.sku_norm,max(c.name) product_name,max(c.image_url) image_url,
    jsonb_agg(distinct c.ad) ads
  from catalog_skus c join covered_sources cs on cs.source=c.source
  where nullif(c.sku_norm,'') is not null group by c.sku_norm
), all_products as (
  select coalesce(c.sku_norm,s.sku_norm) sku_norm,
    coalesce(c.product_name,coalesce(s.sku_norm,'')) product_name,
    c.image_url,coalesce(c.ads,'[]'::jsonb) ads,
    coalesce(s.current_units,0) units,
    coalesce(s.previous_units,0) previous_units,
    coalesce(s.current_revenue,0) revenue
  from catalog_known c full outer join sales_by_sku s on s.sku_norm=c.sku_norm
), benchmark as (
  select avg(units)::numeric average_sold from all_products where units>0
), classified as (
  select p.*,
    (p.units>0) sold,
    (p.units=0) no_sales,
    (p.units>0 and p.units < coalesce(b.average_sold,0)) low_sales,
    (p.units>=3 and (p.previous_units=0 or p.units>=p.previous_units*1.2)) growing
  from all_products p cross join benchmark b
), readiness as (
  select (select count(*) from expected_sources) expected_count,
    (select count(*) from covered_sources) covered_count,
    (select count(*) from covered_sources c cross join windows w where c.previous_days>=w.days) growth_count,
    (select coalesce(min(current_days),0) from covered_sources) covered_days,
    (select coalesce(min(previous_days),0) from covered_sources) previous_days
), qualified as (
  select x.* from classified x cross join readiness r cross join windows w
  where r.covered_count>0 and (
    w.selected_status='ALL'
    or (w.selected_status='SOLD' and x.sold)
    or (w.selected_status='ZERO' and x.no_sales)
    or (w.selected_status='LOW' and x.low_sales)
    or (w.selected_status='RISING' and r.growth_count=r.covered_count and x.growing)
  )
), numbered as (select q.*,count(*) over() total_count from qualified q),
page as (
  select * from numbered order by units desc,revenue desc,sku_norm
  limit (select page_size from windows) offset (select page_offset from windows)
)
select jsonb_build_object(
  'days',(select days from windows),
  'platform',(select platform from windows),
  'current_start',(select current_start from windows),
  'current_end',(select current_end from windows),
  'previous_start',(select previous_start from windows),
  'previous_end',(select previous_end from windows),
  'data_through',(select data_through from windows),
  'has_snapshot',(select data_through is not null from windows),
  'current_ready',(select covered_count>0 from readiness),
  'previous_ready',(select covered_count>0 and growth_count=covered_count from readiness),
  'covered_days',(select covered_days from readiness),
  'covered_previous_days',(select previous_days from readiness),
  'expected_sources',(select coalesce(jsonb_agg(source),'[]'::jsonb) from expected_sources),
  'covered_sources',(select coalesce(jsonb_agg(source),'[]'::jsonb) from covered_sources),
  'sources_missing',(select coalesce(jsonb_agg(source),'[]'::jsonb)
      from expected_sources where source not in (select source from covered_sources)),
  'metrics',jsonb_build_object(
    'sold',(select case when covered_count>0 then (select count(*) from classified where sold) else null end from readiness),
    'zero',(select case when covered_count>0 then (select count(*) from classified where no_sales) else null end from readiness),
    'low',(select case when covered_count>0 then (select count(*) from classified where low_sales) else null end from readiness),
    'rising',(select case when covered_count>0 and growth_count=covered_count
      then (select count(*) from classified where growing) else null end from readiness)
  ),
  'status',(select case when covered_count=0 then 'DAILY_DATA_REQUIRED'
    when growth_count<covered_count then 'GROWTH_HISTORY_REQUIRED'
    when covered_count<expected_count then 'PARTIAL_PLATFORMS'
    else 'READY' end from readiness),
  'total',coalesce((select max(total_count) from numbered),0),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'sku',p.sku_norm,'name',p.product_name,'image_url',p.image_url,
    'units',p.units,'previous_units',p.previous_units,'revenue',p.revenue,
    'sold',p.sold,'low',p.low_sales,'rising',p.growing,
    'growth_percent',case when p.previous_units>0
      then round((p.units-p.previous_units)*100.0/p.previous_units,1) else null end,
    'ads',p.ads
  ) order by p.units desc,p.sku_norm) from page p),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_velocity_v2(integer,text,text,text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.commerce_sales_velocity_v2(integer,text,text,text,integer,integer) to service_role;
