-- Refine the read-only RPC without mutating previously applied migration history.
-- Single read-only analysis of active multi-variation listings.
-- Scan the verified daily ledger once; never equate an unlinked SKU
-- or incomplete date coverage with a variation having zero sales.
create or replace function public.commerce_variation_review_v1(
  p_platform text default 'TODAS',
  p_days integer default 30,
  p_search text default null,
  p_only_zero boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as (
  select case when upper(coalesce(p_platform,'TODAS')) in
    ('TODAS','SHOPEE','MERCADO_LIVRE','ML_ANTIGO','ML_NOVO')
    then upper(coalesce(p_platform,'TODAS')) else 'TODAS' end platform,
    case when p_days in (30,60,90) then p_days else 30 end days,
    nullif(btrim(left(coalesce(p_search,''),120)),'') search,
    coalesce(p_only_zero,false) only_zero,
    greatest(1,least(coalesce(p_limit,20),50)) page_size,
    greatest(0,coalesce(p_offset,0)) page_offset
), listing_base as (
  select l.id,l.title,l.external_listing_id,
    coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url,
    case when m.code='MERCADO_LIVRE'
      then case when upper(coalesce(l.account_code,''))='NOVO'
        then 'ML_NOVO' else 'ML_ANTIGO' end
    else m.code end source
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join input i
  where l.listing_status='ACTIVE'
    and m.code in('MERCADO_LIVRE','SHOPEE')
    and (i.platform='TODAS' or i.platform=m.code
      or (i.platform in ('ML_ANTIGO','ML_NOVO') and m.code='MERCADO_LIVRE'
        and upper(coalesce(l.account_code,''))=
          case when i.platform='ML_NOVO' then 'NOVO' else 'ANTIGO' end))
    and (i.search is null or l.title ilike '%'||i.search||'%'
      or l.external_listing_id ilike '%'||i.search||'%'
      or exists (
        select 1 from public.commerce_listing_products lp
        where lp.listing_id=l.id and lp.relation_status<>'REMOVED'
          and lp.platform_sku ilike '%'||i.search||'%'
      ))
), raw_variations as (
 select l.id listing_id,l.source,l.external_listing_id,l.title,l.url,
   lp.id listing_product_id,lp.variation_id,
   coalesce(nullif(lp.variation_name,''),nullif(lp.platform_sku,''),'Variação sem identificação') variation_name,
   nullif(btrim(lp.platform_sku),'') sku,
   public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm
 from listing_base l
 join public.commerce_listing_products lp on lp.listing_id=l.id
 where lp.relation_status<>'REMOVED' and nullif(lp.variation_id,'') is not null
), multi_listing as (
 select listing_id from raw_variations
 group by listing_id having count(distinct variation_id)>1
), variants as (
 select v.*,
   count(*) over(partition by v.listing_id,v.norm) same_sku_count,
   case when v.source='SHOPEE'
     then exists(
       select 1 from public.commerce_shopee_sku_owner_reviewed_v1 o
       where o.listing_product_id=v.listing_product_id
         and o.listing_id=v.listing_id
         and o.canonical_sku_norm=v.norm
     ) else true end verified_owner
 from raw_variations v join multi_listing ml on ml.listing_id=v.listing_id
), selected_sources as (
 select distinct source from variants
), daily as materialized (
 select d.platform_code source,d.sale_date,d.external_listing_id,
    public.commerce_nisti_sku_norm_v1(d.sku_norm) norm,
    d.units,d.product_revenue
 from public.commerce_current_sales_listing_daily_v1 d
 where d.platform_code in (select source from selected_sources)
), latest as (
 select src.source,max(d.sale_date) end_date
 from selected_sources src
 left join daily d on d.source=src.source
 group by src.source
), report_days as (
 select l.source,
 count(distinct sm.period_start) filter(
   where sm.period_start between l.end_date-29 and l.end_date
     and sm.period_start=sm.period_end)::int covered_30,
 count(distinct sm.period_start) filter(
   where sm.period_start between l.end_date-59 and l.end_date
     and sm.period_start=sm.period_end)::int covered_60,
 count(distinct sm.period_start) filter(
   where sm.period_start between l.end_date-89 and l.end_date
     and sm.period_start=sm.period_end)::int covered_90
 from latest l
 left join public.commerce_sales_import_batches b
   on b.platform_code=l.source and b.status='COMMITTED'
 left join public.commerce_sales_import_stage_summary sm on sm.batch_id=b.id
   and sm.period_start between l.end_date-89 and l.end_date
 group by l.source
), observed_days as (
 select l.source,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-29 and l.end_date)::int observed_30,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-59 and l.end_date)::int observed_60,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-89 and l.end_date)::int observed_90
 from latest l left join daily d on d.source=l.source
   and d.sale_date between l.end_date-89 and l.end_date
 group by l.source
), source_coverage as (
 select l.source,l.end_date,
   (l.end_date is not null and coalesce(r.covered_30,0)>=30
      and (l.source<>'SHOPEE' or coalesce(o.observed_30,0)>=30)) complete_30,
   (l.end_date is not null and coalesce(r.covered_60,0)>=60
      and (l.source<>'SHOPEE' or coalesce(o.observed_60,0)>=60)) complete_60,
   (l.end_date is not null and coalesce(r.covered_90,0)>=90
      and (l.source<>'SHOPEE' or coalesce(o.observed_90,0)>=90)) complete_90
 from latest l
 left join report_days r on r.source=l.source
 left join observed_days o on o.source=l.source
), per_variation as (
 select v.*,c.end_date,c.complete_30,c.complete_60,c.complete_90,
   (v.sku is not null and nullif(v.norm,'') is not null
     and v.same_sku_count=1 and v.verified_owner) match_verified,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-29 and c.end_date),0)::bigint actual_30,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-59 and c.end_date),0)::bigint actual_60,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-89 and c.end_date),0)::bigint actual_90
 from variants v
 join source_coverage c on c.source=v.source
 left join daily d on d.source=v.source
   and d.external_listing_id=v.external_listing_id
   and d.norm=v.norm and d.sale_date between c.end_date-89 and c.end_date
 group by v.listing_id,v.source,v.external_listing_id,v.title,v.url,
   v.listing_product_id,v.variation_id,v.variation_name,v.sku,v.norm,
   v.same_sku_count,v.verified_owner,c.end_date,c.complete_30,c.complete_60,c.complete_90
), safe_variation as (
 select v.*,
   case when v.match_verified and (v.complete_30 or v.actual_30>0) then v.actual_30 else null::bigint end units_30,
   case when v.match_verified and (v.complete_60 or v.actual_60>0) then v.actual_60 else null::bigint end units_60,
   case when v.match_verified and (v.complete_90 or v.actual_90>0) then v.actual_90 else null::bigint end units_90
 from per_variation v
), listed as (
 select v.listing_id,min(v.source) source,
   min(v.external_listing_id) external_listing_id,
   min(v.title) title,min(v.url) url,
   max(v.end_date) period_end,
   count(*)::int variation_count,
   count(*) filter(where
     case when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end =0)::int zero_variations,
   count(*) filter(where
     case when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end >0)::int sold_variations,
   count(*) filter(where
     case when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end is null)::int unknown_variations,
   sum(case when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end) as identified_units,
   jsonb_agg(jsonb_build_object(
     'id',v.listing_product_id,'variation_id',v.variation_id,
     'name',v.variation_name,'sku',v.sku,
     'identified_30',case when v.match_verified then v.actual_30 else null end,
     'identified_60',case when v.match_verified then v.actual_60 else null end,
     'identified_90',case when v.match_verified then v.actual_90 else null end,
     'units_30',v.units_30,'units_60',v.units_60,'units_90',v.units_90,
     'match_verified',v.match_verified,
     'coverage_30',v.complete_30,'coverage_60',v.complete_60,'coverage_90',v.complete_90,
     'match_issue',case when v.sku is null or nullif(v.norm,'') is null then 'MISSING_SKU'
       when v.same_sku_count>1 then 'DUPLICATE_SKU'
       when not v.verified_owner then 'UNVERIFIED_OWNER'
       else null end
   ) order by v.variation_name,v.variation_id,v.listing_product_id) variations
 from safe_variation v group by v.listing_id
), filtered as (
 select a.* from listed a cross join input i
 where not i.only_zero or a.zero_variations>0
), page as (
 select a.* from filtered a
 order by zero_variations desc,unknown_variations desc,title,listing_id
 limit (select page_size from input) offset (select page_offset from input)
)
select jsonb_build_object(
 'days',(select days from input),
 'total',(select count(*) from filtered),
 'kpis',jsonb_build_object(
   'listings',(select count(*) from listed),
   'with_zero',(select count(*) from listed where zero_variations>0),
   'without_proof',(select count(*) from listed where unknown_variations>0)
 ),
 'items',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),
 'coverage',coalesce((select jsonb_agg(to_jsonb(c)) from source_coverage c),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_variation_review_v1(text,integer,text,boolean,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_variation_review_v1(text,integer,text,boolean,integer,integer)
  to service_role;
