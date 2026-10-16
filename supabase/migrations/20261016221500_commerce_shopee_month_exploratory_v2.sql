-- Historical Shopee monthly filters. ABC is provisional and
-- "without identified sales" does not prove an actual zero sale.
-- Keep old RPC v1 untouched; v2 accepts ABC basis from the manager.
create or replace function public.commerce_listing_manager_month_sku_v2(
 p_platform text default 'TODAS', p_month text default null,
 p_search text default null, p_status text default 'ALL',
 p_curve text default 'ALL', p_limit integer default 20, p_offset integer default 0,
 p_basis text default 'REVENUE'
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as (
 select upper(coalesce(nullif(btrim(p_platform),''),'TODAS')) platform,
 to_date(p_month||'-01','YYYY-MM-DD')::date first_day,
 upper(coalesce(nullif(btrim(p_status),''),'ALL')) selected_status,
 upper(coalesce(nullif(btrim(p_curve),''),'ALL')) selected_curve,
 case when upper(coalesce(p_basis,''))='UNITS' then 'UNITS' else 'REVENUE' end basis,
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
 order by v.name,v.variation_id) month_variations,
 count(*) filter(where uv.variation_id is not null and k.units is null)::int identified_empty_variations,
 count(*) filter(where uv.variation_id is not null and k.units>0)::int identified_sold_variations,
 count(*) filter(where uv.variation_id is not null)::int identifiable_variations
 from variants v left join known k on k.listing_id=v.listing_id and k.variation_id=v.variation_id
 left join (select distinct listing_id,variation_id from unique_owner) uv
   on uv.listing_id=v.listing_id and uv.variation_id=v.variation_id
 group by v.listing_id
), decorated as (
 select a.*,coalesce(m.units,0)::bigint month_linked_units,
 coalesce(m.revenue,0)::numeric month_linked_revenue,
 coalesce(v.total_variations,0)::int total_variations,
 coalesce(v.month_variations,'[]'::jsonb) month_variations,
 coalesce(v.identified_empty_variations,0)::int identified_empty_variations,
 coalesce(v.identified_sold_variations,0)::int identified_sold_variations,
 coalesce(v.identifiable_variations,0)::int identifiable_variations
 from ads a
 left join amounts m on m.listing_id=a.id
 left join grouped_variations v on v.listing_id=a.id
), ranked_sales as (
 select d.id,case when i.basis='UNITS' then d.month_linked_units::numeric
   else d.month_linked_revenue end score
 from decorated d cross join input i
), ranked as (
 select r.id,r.score,sum(r.score) over() score_total,
   coalesce(sum(r.score) over(order by r.score desc,r.id
     rows between unbounded preceding and 1 preceding),0) previous_score
 from ranked_sales r where r.score>0
), classified as (
 select d.*,case when r.id is null then null
   when r.previous_score<r.score_total*0.80 then 'A'
   when r.previous_score<r.score_total*0.95 then 'B'
   else 'C' end curve
 from decorated d left join ranked r on r.id=d.id
), filtered as (
 select a.* from classified a cross join input i
 where (i.search is null or a.title ilike '%'||i.search||'%' or a.external_listing_id ilike '%'||i.search||'%')
 and (i.selected_curve='ALL' or a.curve=i.selected_curve)
 and (i.selected_status='ALL' or
   (i.selected_status='SOLD' and a.month_linked_units>0) or
   (i.selected_status='ZERO' and (a.month_linked_units=0
     or a.identified_empty_variations>0)))
), page as (
 select * from filtered order by month_linked_units desc,month_linked_revenue desc,title,id
 limit (select page_size from input) offset (select page_offset from input)
), totals as (
 select count(*)::int active_ads,0::int covered_ads,0::int sold_ads,0::int zero_ads,
 count(*)::int pending_ads,
 count(*) filter(where month_linked_units>0)::int month_linked_ads,
 count(*) filter(where month_linked_units=0 or identified_empty_variations>0)::int identified_empty_ads,
 coalesce(sum(identified_empty_variations),0)::bigint identified_empty_variations,
 coalesce(sum(month_linked_units),0)::bigint month_linked_units,
 coalesce(round(sum(month_linked_revenue),2),0)::numeric month_linked_revenue,
 0::bigint units,0::numeric revenue
 from classified
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
 'account',p.account_code,'curve',p.curve,'curve_partial',true,
 'units',null,'revenue',null,'ready',false,'previous_ready',false,
 'variation_data_complete',false,'total_variations',p.total_variations,
 'sold_variations',null,'zero_variations',null,'variations','[]'::jsonb,
 'month_linked_units',p.month_linked_units,
 'month_linked_revenue',p.month_linked_revenue,
 'month_variations',p.month_variations,
 'identified_empty_variations',p.identified_empty_variations,
 'identified_sold_variations',p.identified_sold_variations,
 'identifiable_variations',p.identifiable_variations,
 'situation',case when p.month_linked_units>0 then 'PARTIAL_SOLD' else 'PENDING' end
 ) order by p.month_linked_units desc,p.month_linked_revenue desc,p.title,p.id) from page p),'[]'::jsonb)
);
$fn$;

revoke all on function public.commerce_listing_manager_month_sku_v2(text,text,text,text,text,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.commerce_listing_manager_month_sku_v2(text,text,text,text,text,integer,integer,text)
  to service_role;
