-- Evolução de Vendas: período de 7 dias e variações desativadas fora do painel.
-- Base: 20261023230000 (cobertura por período + FALLING). Somente leitura.
create or replace function public.commerce_evolution_ads_v1(
  p_platform text default 'TODAS',
  p_days integer default 30,
  p_search text default null,
  p_only_zero boolean default false,
  p_limit integer default 20,
  p_offset integer default 0,
 p_status text default 'ALL'
)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as (
  select case when upper(coalesce(p_platform,'TODAS')) in
    ('TODAS','SHOPEE','MERCADO_LIVRE','ML_ANTIGO','ML_NOVO')
    then upper(coalesce(p_platform,'TODAS')) else 'TODAS' end platform,
    case when p_days in (7,30,60,90) then p_days else 30 end days,
    nullif(btrim(left(coalesce(p_search,''),120)),'') search,
    coalesce(p_only_zero,false) only_zero,
   case when upper(coalesce(p_status,'ALL')) in ('ALL','ZERO','STABLE','RISING','FALLING') then upper(coalesce(p_status,'ALL')) else 'ALL' end status,
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
        where lp.listing_id=l.id and lp.relation_status not in ('REMOVED','INACTIVE')
          and lp.platform_sku ilike '%'||i.search||'%'
      ))
), raw_variations as (
 select l.id listing_id,l.source,l.external_listing_id,l.title,l.url,
   lp.id listing_product_id,
   coalesce(nullif(lp.variation_id,''),nullif(lp.platform_sku,''),'SEM_VARIACAO') variation_id,
   coalesce(nullif(lp.variation_name,''),nullif(lp.platform_sku,''),'Sem variação vinculada') variation_name,
   nullif(btrim(lp.platform_sku),'') sku,
   public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm
 from listing_base l
 left join public.commerce_listing_products lp
   on lp.listing_id=l.id and lp.relation_status not in ('REMOVED','INACTIVE')
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
 from raw_variations v
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
 -- Cobertura = dias abrangidos por relatórios importados (COMMITTED).
 -- Relatórios de período (ex.: Shopee mensal) cobrem cada dia do intervalo;
 -- antes só relatórios de um único dia contavam, e a Shopee nunca ficava completa.
 select l.source,
 count(distinct rd.day) filter(where rd.day between l.end_date-6 and l.end_date)::int covered_7,
 count(distinct rd.day) filter(where rd.day between l.end_date-29 and l.end_date)::int covered_30,
 count(distinct rd.day) filter(where rd.day between l.end_date-59 and l.end_date)::int covered_60,
 count(distinct rd.day) filter(where rd.day between l.end_date-89 and l.end_date)::int covered_90,
 count(distinct rd.day) filter(
   where rd.day between l.end_date-(i.days*2-1) and l.end_date-i.days)::int covered_previous
 from latest l cross join input i
 left join lateral (
   select gs::date as day
   from public.commerce_sales_import_batches b
   join public.commerce_sales_import_stage_summary sm on sm.batch_id=b.id
   cross join lateral generate_series(
     greatest(sm.period_start,l.end_date-179),
     least(sm.period_end,l.end_date),
     interval '1 day') gs
   where b.platform_code=l.source and b.status='COMMITTED'
     and sm.period_start<=sm.period_end
     and sm.period_end>=l.end_date-179 and sm.period_start<=l.end_date
 ) rd on true
 group by l.source
), observed_days as (
 select l.source,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-6 and l.end_date)::int observed_7,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-29 and l.end_date)::int observed_30,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-59 and l.end_date)::int observed_60,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-89 and l.end_date)::int observed_90,
 count(distinct d.sale_date) filter(where d.sale_date between l.end_date-(i.days*2-1) and l.end_date-i.days)::int observed_previous
 from latest l cross join input i left join daily d on d.source=l.source
   and d.sale_date between l.end_date-179 and l.end_date
 group by l.source
), source_coverage as (
 select l.source,l.end_date,
   (l.end_date is not null and coalesce(r.covered_7,0)>=7
      and (l.source<>'SHOPEE' or coalesce(o.observed_7,0)>=7)) complete_7,
   (l.end_date is not null and coalesce(r.covered_30,0)>=30
      and (l.source<>'SHOPEE' or coalesce(o.observed_30,0)>=30)) complete_30,
   (l.end_date is not null and coalesce(r.covered_60,0)>=60
      and (l.source<>'SHOPEE' or coalesce(o.observed_60,0)>=60)) complete_60,
   (l.end_date is not null and coalesce(r.covered_90,0)>=90
      and (l.source<>'SHOPEE' or coalesce(o.observed_90,0)>=90)) complete_90,
   (l.end_date is not null and coalesce(r.covered_previous,0)>=(select days from input)
      and (l.source<>'SHOPEE' or coalesce(o.observed_previous,0)>=(select days from input))) complete_previous
 from latest l
 left join report_days r on r.source=l.source
 left join observed_days o on o.source=l.source
), ad_daily as (
 select l.id listing_id,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-6 and c.end_date),0)::bigint total_7,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-29 and c.end_date),0)::bigint total_30,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-59 and c.end_date),0)::bigint total_60,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-89 and c.end_date),0)::bigint total_90,
   coalesce(sum(d.units) filter(where
     d.sale_date between c.end_date-(i.days-1) and c.end_date),0)::bigint current_window_units,
   coalesce(sum(d.units) filter(where
     d.sale_date between c.end_date-(2*i.days-1) and c.end_date-i.days),0)::bigint previous_window_units,
   round(coalesce(sum(d.product_revenue) filter(where d.sale_date between c.end_date-6 and c.end_date),0),2) revenue_7,
   round(coalesce(sum(d.product_revenue) filter(where d.sale_date between c.end_date-29 and c.end_date),0),2) revenue_30,
   round(coalesce(sum(d.product_revenue) filter(where d.sale_date between c.end_date-59 and c.end_date),0),2) revenue_60,
   round(coalesce(sum(d.product_revenue) filter(where d.sale_date between c.end_date-89 and c.end_date),0),2) revenue_90
 from listing_base l
 join source_coverage c on c.source=l.source
 cross join input i
 left join daily d on d.source=l.source
   and d.external_listing_id=l.external_listing_id
   and d.sale_date between c.end_date-greatest(89,2*i.days-1) and c.end_date
 group by l.id
), per_variation as (
 select v.*,c.end_date,c.complete_7,c.complete_30,c.complete_60,c.complete_90,c.complete_previous,
   (v.sku is not null and nullif(v.norm,'') is not null
     and v.same_sku_count=1 and v.verified_owner) match_verified,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-6 and c.end_date),0)::bigint actual_7,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-29 and c.end_date),0)::bigint actual_30,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-59 and c.end_date),0)::bigint actual_60,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-89 and c.end_date),0)::bigint actual_90,
   coalesce(sum(d.units) filter(where d.sale_date between c.end_date-((select days from input)*2-1)
     and c.end_date-(select days from input)),0)::bigint actual_previous
 from variants v
 join source_coverage c on c.source=v.source
 left join daily d on d.source=v.source
   and d.external_listing_id=v.external_listing_id
   and d.norm=v.norm and d.sale_date between c.end_date-179 and c.end_date
 group by v.listing_id,v.source,v.external_listing_id,v.title,v.url,
   v.listing_product_id,v.variation_id,v.variation_name,v.sku,v.norm,
   v.same_sku_count,v.verified_owner,c.end_date,c.complete_7,c.complete_30,c.complete_60,c.complete_90,c.complete_previous
), safe_variation as (
 select v.*,
   case when v.match_verified and (v.complete_7 or v.actual_7>0) then v.actual_7 else null::bigint end units_7,
   case when v.match_verified and (v.complete_30 or v.actual_30>0) then v.actual_30 else null::bigint end units_30,
   case when v.match_verified and (v.complete_60 or v.actual_60>0) then v.actual_60 else null::bigint end units_60,
   case when v.match_verified and (v.complete_90 or v.actual_90>0) then v.actual_90 else null::bigint end units_90,
   case when v.match_verified and v.complete_previous then v.actual_previous else null::bigint end previous_units
 from per_variation v
), listed as (
 select v.listing_id,min(v.source) source,
   min(v.external_listing_id) external_listing_id,
   min(v.title) title,min(v.url) url,
   max(v.end_date) period_end,
   count(v.listing_product_id)::int variation_count,
   -- Compare recorded advertisement-level sales by stable external ID, not SKU coverage.
   -- Both windows are the same length and end on the latest imported sales date.
   max(ad.current_window_units)::bigint current_window_units,
   max(ad.previous_window_units)::bigint previous_window_units,
   -- These are *observations*, not proven zeros without full date coverage.
   count(*) filter(where v.listing_product_id is not null and v.match_verified
     and (case (select days from input)
       when 7 then v.actual_7 when 30 then v.actual_30 when 60 then v.actual_60 else v.actual_90 end)=0
   )::int unsold_identified_variations,
   -- When sales exist by listing ID but cannot be assigned to a SKU,
   -- a zero-SKU row is pending, never confirmed as a zero-sale variation.
   (case when (case (select days from input)
      when 7 then coalesce(ad.total_7,0) when 30 then coalesce(ad.total_30,0)
      when 60 then coalesce(ad.total_60,0)
      else coalesce(ad.total_90,0) end
    > coalesce(sum(case when v.match_verified then
      case (select days from input)
        when 7 then v.actual_7 when 30 then v.actual_30 when 60 then v.actual_60 else v.actual_90 end
      else 0 end),0)) then 0
     else count(*) filter(where case when (select days from input)=7 then v.units_7 when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end =0) end)::int zero_variations,
   count(*) filter(where case when (select days from input)=7 then v.units_7 when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end >0)::int sold_variations,
   (case when (case (select days from input)
      when 7 then coalesce(ad.total_7,0) when 30 then coalesce(ad.total_30,0)
      when 60 then coalesce(ad.total_60,0)
      else coalesce(ad.total_90,0) end
    > coalesce(sum(case when v.match_verified then
      case (select days from input)
        when 7 then v.actual_7 when 30 then v.actual_30 when 60 then v.actual_60 else v.actual_90 end
      else 0 end),0))
     then count(*) filter(where (case when (select days from input)=7 then v.units_7 when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end) is null or (case when (select days from input)=7 then v.units_7 when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end)=0)
     else count(*) filter(where (case when (select days from input)=7 then v.units_7 when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end) is null) end)::int unknown_variations,
   sum(case when (select days from input)=7 then v.units_7 when (select days from input)=30 then v.units_30
          when (select days from input)=60 then v.units_60 else v.units_90 end) as identified_units,
   count(*) filter(where v.previous_units is null)::int previous_unknown,
   sum(v.previous_units) previous_units,
   case when bool_and(v.complete_7) and count(*) filter(where v.units_7 is null)=0
       and sum(v.units_7)=coalesce(ad.total_7,0) then sum(v.units_7) else null end units_7,
   case when bool_and(v.complete_30) and count(*) filter(where v.units_30 is null)=0
       and sum(v.units_30)=coalesce(ad.total_30,0) then sum(v.units_30) else null end units_30,
   case when bool_and(v.complete_60) and count(*) filter(where v.units_60 is null)=0
       and sum(v.units_60)=coalesce(ad.total_60,0) then sum(v.units_60) else null end units_60,
   case when bool_and(v.complete_90) and count(*) filter(where v.units_90 is null)=0
       and sum(v.units_90)=coalesce(ad.total_90,0) then sum(v.units_90) else null end units_90,
   coalesce(ad.total_7,0) identified_7,
   coalesce(ad.total_30,0) identified_30,
   coalesce(ad.total_60,0) identified_60,
   coalesce(ad.total_90,0) identified_90,
   coalesce(ad.revenue_7,0) revenue_7,
   coalesce(ad.revenue_30,0) revenue_30,
   coalesce(ad.revenue_60,0) revenue_60,
   coalesce(ad.revenue_90,0) revenue_90,
   bool_and(v.complete_7) coverage_7,
   bool_and(v.complete_30) coverage_30,
   bool_and(v.complete_60) coverage_60,
   bool_and(v.complete_90) coverage_90,
   greatest(0,coalesce(ad.total_7,0)-coalesce(sum(v.actual_7) filter(where v.match_verified),0)) unlinked_7,
   greatest(0,coalesce(ad.total_30,0)-coalesce(sum(v.actual_30) filter(where v.match_verified),0)) unlinked_30,
   greatest(0,coalesce(ad.total_60,0)-coalesce(sum(v.actual_60) filter(where v.match_verified),0)) unlinked_60,
   greatest(0,coalesce(ad.total_90,0)-coalesce(sum(v.actual_90) filter(where v.match_verified),0)) unlinked_90,
   jsonb_agg(jsonb_build_object(
     'id',v.listing_product_id,'variation_id',v.variation_id,
     'name',v.variation_name,'sku',v.sku,
     'identified_7',case when v.match_verified then v.actual_7 else null end,
     'identified_30',case when v.match_verified then v.actual_30 else null end,
     'identified_60',case when v.match_verified then v.actual_60 else null end,
     'identified_90',case when v.match_verified then v.actual_90 else null end,
     'units_7',v.units_7,'units_30',v.units_30,'units_60',v.units_60,'units_90',v.units_90,
     'match_verified',v.match_verified,
     'coverage_7',v.complete_7,'coverage_30',v.complete_30,'coverage_60',v.complete_60,'coverage_90',v.complete_90,
     'match_issue',case when v.sku is null or nullif(v.norm,'') is null then 'MISSING_SKU'
       when v.same_sku_count>1 then 'DUPLICATE_SKU'
       when not v.verified_owner then 'UNVERIFIED_OWNER'
       else null end
   ) order by v.variation_name,v.variation_id,v.listing_product_id) variations
 from safe_variation v
 join ad_daily ad on ad.listing_id=v.listing_id
 group by v.listing_id,ad.total_7,ad.total_30,ad.total_60,ad.total_90,ad.revenue_7,ad.revenue_30,ad.revenue_60,ad.revenue_90
), classified as (
 select a.*,
   case
     when a.variation_count>0 and a.unknown_variations=0
       and a.zero_variations=a.variation_count
       and (case (select days from input)
         when 7 then a.identified_7 when 30 then a.identified_30 when 60 then a.identified_60
         else a.identified_90 end)=0 then 'ZERO'
     when a.previous_window_units>=3
       and a.current_window_units-a.previous_window_units>=2
       and a.current_window_units>=a.previous_window_units*1.2 then 'RISING'
     when a.previous_window_units>=3
       and a.previous_window_units-a.current_window_units>=2
       and a.current_window_units<=a.previous_window_units*.8 then 'FALLING'
     when a.previous_window_units>=3 and a.current_window_units>0 then 'STABLE'
     else 'INSUFFICIENT'
   end situation
 from listed a
), filtered as (
 select a.* from classified a cross join input i
 where (not i.only_zero or a.zero_variations>0)
   and (i.status='ALL'
     or (i.status='ZERO' and (
       (case i.days when 7 then a.identified_7 when 30 then a.identified_30 when 60 then a.identified_60
         else a.identified_90 end)=0
       or (a.unsold_identified_variations>0
         and (case i.days when 7 then a.unlinked_7 when 30 then a.unlinked_30
          when 60 then a.unlinked_60 else a.unlinked_90 end)=0)))
     or (i.status<>'ZERO' and a.situation=i.status))
), page as (
 select a.* from filtered a
 -- Present ads with confirmed/identified sales first; avoid a first page full
 -- of zeros while 342 active ads have sales in the imported window.
 order by (case when (select status from input)='ZERO' then
     case when (case (select days from input)
       when 7 then a.identified_7 when 30 then a.identified_30 when 60 then a.identified_60
       else a.identified_90 end)=0 then 0 else 1 end
     else 0 end) asc,
   (case (select days from input)
     when 7 then a.identified_7 when 30 then a.identified_30 when 60 then a.identified_60 else a.identified_90 end)
     desc,
   a.unsold_identified_variations desc,a.unknown_variations asc,
   a.zero_variations desc,a.title,a.listing_id
 limit (select page_size from input) offset (select page_offset from input)
)
select jsonb_build_object(
 'days',(select days from input),
 'total',(select count(*) from filtered),
 'kpis',jsonb_build_object(
   'listings',(select count(*) from classified),
   'total',(select count(*) from classified),
   -- The Zero filter includes listings without observed sales *and* listings
   -- where any verified variation has no observed sales, including partial reports.
   'zero',(select count(*) from classified a cross join input i where
     (case i.days when 7 then a.identified_7 when 30 then a.identified_30 when 60 then a.identified_60
       else a.identified_90 end)=0
       or (a.unsold_identified_variations>0
         and (case i.days when 7 then a.unlinked_7 when 30 then a.unlinked_30
           when 60 then a.unlinked_60 else a.unlinked_90 end)=0)),
   'no_sales_ads',(select count(*) from classified a cross join input i
     where (case i.days when 7 then a.identified_7 when 30 then a.identified_30
       when 60 then a.identified_60 else a.identified_90 end)=0),
   'selling_ads_with_unsold_variations',(select count(*) from classified a cross join input i
     where (case i.days when 7 then a.identified_7 when 30 then a.identified_30
       when 60 then a.identified_60 else a.identified_90 end)>0
       and (case i.days when 7 then a.unlinked_7 when 30 then a.unlinked_30
         when 60 then a.unlinked_60 else a.unlinked_90 end)=0
       and a.unsold_identified_variations>0),
   'confirmed_zero',(select count(*) from classified where situation='ZERO'),
   'stable',(select count(*) from classified where situation='STABLE'),
   'rising',(select count(*) from classified where situation='RISING'),
   'falling',(select count(*) from classified where situation='FALLING'),
   'with_zero',(select count(*) from classified where zero_variations>0),
   'with_sales',(select count(*) from classified where
      case (select days from input)
        when 7 then identified_7 when 30 then identified_30 when 60 then identified_60 else identified_90 end >0),
   'missing_variations',(select count(*) from classified where variation_count=0),
   'without_proof',(select count(*) from classified where unknown_variations>0)
 ),
 'items',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'::jsonb),
 'coverage',coalesce((select jsonb_agg(to_jsonb(c)) from source_coverage c),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_evolution_ads_v1(text,integer,text,boolean,integer,integer,text)
  from public,anon,authenticated;
grant execute on function public.commerce_evolution_ads_v1(text,integer,text,boolean,integer,integer,text)
  to service_role;
