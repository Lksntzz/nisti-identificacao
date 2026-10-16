-- Add validated exploratory trend filters to the daily Shopee listing manager.
-- Rising: >=20% growth, >=3 attributed units in both current and previous windows.
-- Falling: >=20% decline, >=3 previous units and >0 current units.
-- Previous and current periods have the same number of days, anchored on
-- latest imported date. Zero baseline or zero identified current units is
-- deliberately excluded; it does not prove no actual sales.
-- All data is read-only; classifications are provisional by linked SKU.
create or replace function public.commerce_listing_manager_v1(
  p_platform text default 'TODAS',
  p_days integer default 30,
  p_reference_month text default null,
  p_search text default null,
  p_status text default 'ALL',
  p_curve text default 'ALL',
  p_basis text default 'REVENUE',
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with input as (
  select upper(coalesce(nullif(btrim(p_platform),''),'TODAS')) platform,
    case when p_days=0 and p_reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then 0
         when p_days in (7,30,60,90) then p_days else 30 end days,
    case when p_reference_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
      then (to_date(p_reference_month||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date
      else null::date end month_end,
    nullif(btrim(coalesce(p_search,'')),'') search,
    upper(coalesce(nullif(btrim(p_status),''),'ALL')) selected_status,
    upper(coalesce(nullif(btrim(p_curve),''),'ALL')) selected_curve,
    upper(coalesce(nullif(btrim(p_basis),''),'REVENUE')) basis,
    greatest(1,least(coalesce(p_limit,20),100)) page_size,
    greatest(0,coalesce(p_offset,0)) page_offset
), listings as (
  select l.id,l.external_listing_id,l.title,
    coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url,
    m.code marketplace_code,m.name marketplace_name,
    l.account_code,
    case when m.code='MERCADO_LIVRE'
      then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
      else m.code end source_code
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join input i
  where l.listing_status='ACTIVE'
    and (i.platform='TODAS' or i.platform=m.code
      or (m.code='MERCADO_LIVRE' and i.platform in ('ML_ANTIGO','ML_NOVO')
        and upper(coalesce(l.account_code,''))=case when i.platform='ML_NOVO' then 'NOVO' else 'ANTIGO' end))
), latest_sale as (
  select max(d.sale_date) last_day
  from public.commerce_current_sales_listing_daily_v1 d
  where d.platform_code in (select distinct source_code from listings)
), dates_raw as (
  select case when i.days=0
    then least(i.month_end, (now() at time zone 'America/Sao_Paulo')::date-1)
    else least(
      (now() at time zone 'America/Sao_Paulo')::date-1,
      coalesce((select last_day from latest_sale),(now() at time zone 'America/Sao_Paulo')::date-1)
    ) end period_end,
    i.days selected_days,i.month_end,
    i.search,i.platform,i.selected_status,i.selected_curve,i.basis,i.page_size,i.page_offset
  from input i
), dates as (
  select d.period_end,
    case when d.selected_days=0 and d.month_end is not null then
      greatest(1,d.period_end-date_trunc('month',d.month_end)::date+1)
    else d.selected_days end days,
    d.search,d.platform,d.selected_status,d.selected_curve,d.basis,d.page_size,d.page_offset
  from dates_raw d
), bounds as (
  select d.*,d.period_end-d.days+1 period_start,
    d.period_end-d.days previous_end,
    d.period_end-d.days*2+1 previous_start
  from dates d
), day_coverage as (
  select src.source_code,
    count(distinct s.period_start) filter(where s.period_start between b.period_start and b.period_end
      and s.period_start=s.period_end)::int current_days,
    count(distinct s.period_start) filter(where s.period_start between b.previous_start and b.previous_end
      and s.period_start=s.period_end)::int previous_days,
    count(distinct s.period_start) filter(where s.period_start between b.period_end-6 and b.period_end
      and s.period_start=s.period_end)::int days_7,
    count(distinct s.period_start) filter(where s.period_start between b.period_end-29 and b.period_end
      and s.period_start=s.period_end)::int days_30,
    count(distinct s.period_start) filter(where s.period_start between b.period_end-59 and b.period_end
      and s.period_start=s.period_end)::int days_60,
    count(distinct s.period_start) filter(where s.period_start between b.period_end-89 and b.period_end
      and s.period_start=s.period_end)::int days_90
  from (select distinct source_code from listings) src cross join bounds b
  left join public.commerce_sales_import_batches ib
    on ib.platform_code=src.source_code and ib.status='COMMITTED'
  left join public.commerce_sales_import_stage_summary s on s.batch_id=ib.id
  group by src.source_code
), listing_units as (
  select l.id,
    coalesce(sum(d.units) filter(where d.sale_date between b.period_start and b.period_end),0)::bigint units,
    coalesce(round(sum(d.product_revenue) filter(where d.sale_date between b.period_start and b.period_end),2),0)::numeric revenue,
    coalesce(sum(d.units) filter(where d.sale_date between b.previous_start and b.previous_end),0)::bigint prev_units,
    coalesce(round(sum(d.product_revenue) filter(where d.sale_date between b.previous_start and b.previous_end),2),0)::numeric prev_revenue,
    coalesce(sum(d.units) filter(where d.sale_date between b.period_end-6 and b.period_end),0)::bigint units_7,
    coalesce(sum(d.units) filter(where d.sale_date between b.period_end-29 and b.period_end),0)::bigint units_30,
    coalesce(sum(d.units) filter(where d.sale_date between b.period_end-59 and b.period_end),0)::bigint units_60,
    coalesce(sum(d.units) filter(where d.sale_date between b.period_end-89 and b.period_end),0)::bigint units_90
  from listings l cross join bounds b
  left join public.commerce_current_sales_listing_daily_v1 d
    on d.external_listing_id=l.external_listing_id and d.platform_code=l.source_code
    and d.sale_date between b.period_end-179 and b.period_end
  group by l.id
), variants as (
  select lp.id,l.id listing_id,
    nullif(lp.variation_id,'') variation_id,
    coalesce(nullif(lp.variation_name,''),nullif(lp.platform_sku,''),'Variação sem nome') variation_name,
    public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku_norm
  from listings l join public.commerce_listing_products lp on lp.listing_id=l.id
  where lp.relation_status<>'REMOVED' and nullif(lp.variation_id,'') is not null
), sku_totals as (
  select l.id listing_id,public.commerce_nisti_sku_norm_v1(d.sku_norm) sku_norm,
    sum(d.units)::bigint units,round(sum(d.product_revenue),2) revenue
  from listings l cross join bounds b
  join public.commerce_current_sales_listing_daily_v1 d
    on d.external_listing_id=l.external_listing_id and d.platform_code=l.source_code
    and d.sale_date between b.period_start and b.period_end
  where nullif(public.commerce_nisti_sku_norm_v1(d.sku_norm),'') is not null
  group by l.id,public.commerce_nisti_sku_norm_v1(d.sku_norm)
), variant_uniqueness as (
  select listing_id,sku_norm,count(*) as sku_uses
  from variants group by listing_id,sku_norm
), variation_count as (
  select v.listing_id,count(*)::int total_variations,
    count(*) filter(where vu.sku_uses>1 or nullif(v.sku_norm,'') is null)::int ambiguous_variations
  from variants v
  left join variant_uniqueness vu on vu.listing_id=v.listing_id and vu.sku_norm=v.sku_norm
  group by v.listing_id
), unmatched_units as (
  select t.listing_id,coalesce(sum(t.units),0)::bigint unmapped_units
  from sku_totals t
  where not exists(select 1 from variants v
    where v.listing_id=t.listing_id and v.sku_norm=t.sku_norm)
  group by t.listing_id
), v_sold as (
  select v.listing_id,v.variation_id,v.variation_name,v.sku_norm,
    case when vc.ambiguous_variations>0 or coalesce(u.unmapped_units,0)>0
      then null::bigint else coalesce(st.units,0) end units,
    case when vc.ambiguous_variations>0 or coalesce(u.unmapped_units,0)>0
      then null::numeric else coalesce(st.revenue,0) end revenue
  from variants v join variation_count vc on vc.listing_id=v.listing_id
  left join unmatched_units u on u.listing_id=v.listing_id
  left join sku_totals st on st.listing_id=v.listing_id and st.sku_norm=v.sku_norm
), variation_rollup as (
  select vs.listing_id,
    count(*)::int total_variations,
    count(*) filter(where vs.units>0)::int sold_variations,
    count(*) filter(where vs.units=0)::int zero_variations,
    jsonb_agg(jsonb_build_object(
      'id',vs.variation_id,'name',vs.variation_name,'sku',vs.sku_norm,
      'units',vs.units,'revenue',vs.revenue
    ) order by vs.variation_name,vs.variation_id) variations
  from v_sold vs group by vs.listing_id
), identified_variations as (
  select v.listing_id,
    jsonb_agg(jsonb_build_object(
      'id',v.variation_id,'name',v.variation_name,'sku',v.sku_norm,
      'units',st.units,'revenue',st.revenue,'partial',true
    ) order by v.variation_name,v.variation_id) as variations,
    count(*) filter(where vu.sku_uses=1 and nullif(v.sku_norm,'') is not null
      and coalesce(st.units,0)=0)::int identified_empty_variations,
    count(*) filter(where vu.sku_uses=1 and st.units>0)::int identified_sold_variations,
    count(*) filter(where vu.sku_uses=1 and nullif(v.sku_norm,'') is not null)::int identifiable_variations
  from variants v
  left join variant_uniqueness vu on vu.listing_id=v.listing_id and vu.sku_norm=v.sku_norm
  left join sku_totals st on st.listing_id=v.listing_id and st.sku_norm=v.sku_norm
    and vu.sku_uses=1
  group by v.listing_id
), listing_base as (
  select l.*,coalesce(u.units,0)::bigint units,coalesce(u.revenue,0)::numeric revenue,
    coalesce(u.prev_units,0)::bigint prev_units,
    case when l.source_code='SHOPEE' then coalesce(u.units,0)::bigint else null end identified_units,
    case when l.source_code='SHOPEE' then coalesce(u.prev_units,0)::bigint else null end identified_prev_units,
    case when l.source_code='SHOPEE' then coalesce(u.prev_revenue,0)::numeric else null end identified_prev_revenue,
    case when l.source_code='SHOPEE' then coalesce(u.revenue,0)::numeric else null end identified_revenue,
    iv.variations identified_variations,
    case when l.source_code='SHOPEE' then coalesce(iv.identified_empty_variations,0) else null end identified_empty_variations,
    case when l.source_code='SHOPEE' then coalesce(iv.identified_sold_variations,0) else null end identified_sold_variations,
    case when l.source_code='SHOPEE' then coalesce(iv.identifiable_variations,0) else null end identifiable_variations,
    case when dc.days_7=7 then u.units_7 else null end units_7,
    case when dc.days_30=30 then u.units_30 else null end units_30,
    case when dc.days_60=60 then u.units_60 else null end units_60,
    case when dc.days_90=90 then u.units_90 else null end units_90,
    (dc.current_days>=b.days and l.source_code<>'SHOPEE') ready,
    (dc.previous_days>=b.days and l.source_code<>'SHOPEE') previous_ready,
    coalesce(vr.total_variations,0) total_variations,
    case when dc.current_days>=b.days and
      coalesce(vc.ambiguous_variations,0)=0 and coalesce(um.unmapped_units,0)=0
      then coalesce(vr.sold_variations,0) else null end sold_variations,
    case when dc.current_days>=b.days and
      coalesce(vc.ambiguous_variations,0)=0 and coalesce(um.unmapped_units,0)=0
      then coalesce(vr.zero_variations,0) else null end zero_variations,
    case when dc.current_days>=b.days and coalesce(vc.ambiguous_variations,0)=0
      and coalesce(um.unmapped_units,0)=0 then vr.variations else null end variations,
    coalesce(um.unmapped_units,0)::bigint unmapped_units,
    coalesce(vc.ambiguous_variations,0)::int ambiguous_variations
  from listings l cross join bounds b
  join day_coverage dc on dc.source_code=l.source_code
  left join listing_units u on u.id=l.id
  left join identified_variations iv on iv.listing_id=l.id
  left join variation_rollup vr on vr.listing_id=l.id
  left join variation_count vc on vc.listing_id=l.id
  left join unmatched_units um on um.listing_id=l.id
), mean_sales as (
  select avg(units)::numeric average_units from listing_base where ready and units>0
), flagged as (
  select l.*,
    case when l.source_code='SHOPEE' and coalesce(l.identified_units,0)>0 then 'PARTIAL_SOLD'
      when l.source_code='SHOPEE' then 'UNCONFIRMED_NO_SALES'
      when not ready then 'PENDING'
      when units=0 then 'ZERO'
      when coalesce(zero_variations,0)>0 then 'PARTIAL_ZERO'
      else 'SOLD' end situation,
    (l.ready and l.units>0 and l.units<coalesce(m.average_units,0)) low_sales,
    (l.ready and l.previous_ready and l.units>=3 and
      (l.prev_units=0 or l.units>=l.prev_units*1.2)) growing,
    case
      -- Both windows must have actual linked sales; a missing SKU is not zero.
      -- Minimum 3 units in the previous window prevents 1->2 noise.
      when l.source_code='SHOPEE' and l.identified_prev_units>=3 and
        l.identified_units>=3 and l.identified_units>=l.identified_prev_units*1.2
        then 'RISING'
      when l.source_code='SHOPEE' and l.identified_prev_units>=3 and
        l.identified_units>0 and l.identified_units<=l.identified_prev_units*0.8
        then 'FALLING'
      else null end identified_trend,
    case when l.source_code='SHOPEE' then
      case when b.basis='UNITS' then l.identified_units::numeric else l.identified_revenue end
      when l.ready then
      case when b.basis='UNITS' then l.units::numeric else l.revenue end
    else 0::numeric end score
  from listing_base l cross join mean_sales m cross join bounds b
), ranked as (
  select f.id,f.score,
    sum(f.score) over() score_total,
    coalesce(sum(f.score) over(order by f.score desc,f.id rows between unbounded preceding and 1 preceding),0) previous_score
  from flagged f where f.score>0
), classified as (
  select f.*,case when r.id is null then null
      when r.previous_score<r.score_total*0.80 then 'A'
      when r.previous_score<r.score_total*0.95 then 'B'
      else 'C' end curve
  from flagged f left join ranked r on r.id=f.id
), filtered as (
  select c.* from classified c cross join bounds b
  where (b.search is null or c.title ilike '%'||b.search||'%'
    or c.external_listing_id ilike '%'||b.search||'%')
    and (b.selected_curve='ALL' or c.curve=b.selected_curve)
    and (b.selected_status='ALL'
      or (b.selected_status='SOLD' and c.ready and c.units>0)
      or (b.selected_status='SOLD' and c.source_code='SHOPEE' and c.identified_units>0)
      or (b.selected_status='ZERO' and c.ready and (c.units=0 or c.zero_variations>0))
      -- Exploratory filter only: identifies missing linked sales, NOT proven zero.
      or (b.selected_status='ZERO' and c.source_code='SHOPEE' and
        (coalesce(c.identified_units,0)=0 or coalesce(c.identified_empty_variations,0)>0))
      or (b.selected_status='LOW' and c.low_sales)
      or (b.selected_status='RISING' and (c.growing
        or (c.source_code='SHOPEE' and c.identified_trend='RISING')))
      or (b.selected_status='FALLING' and c.source_code='SHOPEE'
        and c.identified_trend='FALLING')
      or (b.selected_status='PENDING' and not c.ready))
), page as (
  select c.* from filtered c
  order by
    case when b.selected_status='RISING' and c.source_code='SHOPEE'
      then (c.identified_units-c.identified_prev_units)::numeric/nullif(c.identified_prev_units,0)
      else null end desc nulls last,
    case when b.selected_status='FALLING' and c.source_code='SHOPEE'
      then (c.identified_units-c.identified_prev_units)::numeric/nullif(c.identified_prev_units,0)
      else null end asc nulls last,
    case when c.ready or coalesce(c.identified_units,0)>0 then 0 else 1 end,
    c.units desc,c.revenue desc,c.title,c.id
  limit (select page_size from bounds) offset (select page_offset from bounds)
), kpis as (
  select count(*)::int active_ads,
    count(*) filter(where ready)::int covered_ads,
    count(*) filter(where ready and units>0)::int sold_ads,
    count(*) filter(where identified_units>0)::int identified_ads,
    coalesce(sum(identified_units),0)::bigint identified_units,
    coalesce(round(sum(identified_revenue),2),0)::numeric identified_revenue,
    count(*) filter(where ready and (units=0 or zero_variations>0))::int zero_ads,
    count(*) filter(where source_code='SHOPEE' and
      (coalesce(identified_units,0)=0 or coalesce(identified_empty_variations,0)>0))::int identified_empty_ads,
    coalesce(sum(identified_empty_variations) filter(where source_code='SHOPEE'),0)::bigint identified_empty_variations,
    count(*) filter(where source_code='SHOPEE' and identified_trend='RISING')::int growing_identified_ads,
    count(*) filter(where source_code='SHOPEE' and identified_trend='FALLING')::int falling_identified_ads,
    count(*) filter(where low_sales)::int low_ads,
    count(*) filter(where growing)::int growing_ads,
    count(*) filter(where not ready)::int pending_ads,
    coalesce(sum(units) filter(where ready),0)::bigint units,
    coalesce(sum(revenue) filter(where ready),0)::numeric revenue
  from classified
), classes as (
  select curve,count(*)::int ads,coalesce(sum(units),0)::bigint units,
    coalesce(sum(revenue),0)::numeric revenue
  from classified where curve is not null group by curve
), imported_month as (
  -- Totais da plataforma: nunca converter SKU agregado em ID real de anúncio.
  select min(s.period_start) period_start,max(s.period_end) period_end,
    coalesce(sum(s.net_orders),0)::bigint orders,
    coalesce(sum(s.units),0)::bigint units,
    coalesce(round(sum(s.product_revenue),2),0)::numeric revenue
  from public.commerce_sales_summary_rows s
  join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current=true
  cross join input i
  where i.days=0 and i.month_end is not null
    and s.period_start=date_trunc('month',i.month_end)::date
    and s.platform_code in (select distinct source_code from listings)
)
select jsonb_build_object(
  'period_start',(select period_start from bounds),
  'period_end',(select period_end from bounds),
  'days',(select days from bounds),
  'data_through',(select last_day from latest_sale),
  'source_kind',case when (select platform from input)='SHOPEE'
    then 'DAILY_SKU_PARTIAL' else 'DAILY_BY_LISTING' end,
  'imported_month',(select case when period_start is not null then
    jsonb_build_object('period_start',period_start,'period_end',period_end,
      'orders',orders,'units',units,'revenue',revenue)
    else null end from imported_month),
  'coverage',coalesce((select jsonb_agg(jsonb_build_object(
    'platform',dc.source_code,'covered_days',dc.current_days,'previous_days',dc.previous_days
  ) order by dc.source_code) from day_coverage dc),'[]'::jsonb),
  'kpis',(select to_jsonb(k) from kpis k),
  'total',(select count(*) from filtered),
  'classes',coalesce((select jsonb_agg(jsonb_build_object(
    'curve',x.curve,'ads',x.ads,'units',x.units,'revenue',x.revenue
  ) order by x.curve) from classes x),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'external_listing_id',p.external_listing_id,
    'title',p.title,'url',p.url,'platform',p.marketplace_code,
    'platform_name',p.marketplace_name,'account',p.account_code,
    'source',p.source_code,'units',case when p.ready then p.units else null end,
    'identified_units',p.identified_units,'identified_revenue',p.identified_revenue,
    'identified_prev_units',p.identified_prev_units,
    'identified_prev_revenue',p.identified_prev_revenue,
    'identified_empty_variations',p.identified_empty_variations,
    'identified_sold_variations',p.identified_sold_variations,
    'identifiable_variations',p.identifiable_variations,
    'identified_growth_pct',case when p.source_code='SHOPEE' and
      p.identified_prev_units>=3 and p.identified_units>0
      then round((p.identified_units-p.identified_prev_units)*100.0/p.identified_prev_units,1)
      else null end,
    'identified_trend',p.identified_trend,
    'identified_variations',coalesce(p.identified_variations,'[]'::jsonb),
    'revenue',case when p.ready then p.revenue else null end,
    'prev_units',case when p.previous_ready then p.prev_units else null end,
    'units_7',p.units_7,'units_30',p.units_30,'units_60',p.units_60,'units_90',p.units_90,
    'ready',p.ready,'previous_ready',p.previous_ready,
    'total_variations',p.total_variations,
    'sold_variations',p.sold_variations,'zero_variations',p.zero_variations,
    'variation_data_complete',p.variations is not null or p.total_variations=0,
    'variations',coalesce(p.variations,'[]'::jsonb),
    'unmapped_units',p.unmapped_units,'ambiguous_variations',p.ambiguous_variations,
    'situation',p.situation,'low_sales',p.low_sales,'growing',p.growing,
    'curve',p.curve,'curve_partial',p.source_code='SHOPEE' and p.curve is not null
  ) order by case when p.ready or coalesce(p.identified_units,0)>0 then 0 else 1 end,
    p.units desc,p.revenue desc,p.title,p.id)
  from page p),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_listing_manager_v1(text,integer,text,text,text,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_listing_manager_v1(text,integer,text,text,text,text,text,integer,integer)
  to service_role;

