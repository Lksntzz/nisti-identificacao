-- Variações candidatas a remover (somente leitura).
-- Candidata = variação de anúncio ATIVO, com SKU verificado, 0 vendas nos
-- últimos 90 dias com cobertura completa de relatórios, sem vendas do anúncio
-- sem SKU atribuído, e com ao menos uma outra variação do mesmo anúncio vendendo.
-- "kind": NEVER = sem venda em todo o histórico importado; STOPPED = vendia e parou.
create or replace function public.commerce_variation_removal_candidates_v1(
  p_platform text default 'TODAS', p_limit integer default 50, p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = public as $fn$
with input as (
  select case when upper(coalesce(p_platform,'TODAS')) in ('TODAS','SHOPEE','MERCADO_LIVRE','ML_ANTIGO','ML_NOVO')
      then upper(coalesce(p_platform,'TODAS')) else 'TODAS' end platform,
    greatest(1,least(coalesce(p_limit,50),200)) page_size, greatest(0,coalesce(p_offset,0)) page_offset
), listing_base as (
  select l.id, l.title, l.external_listing_id,
    coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url,
    case when m.code='MERCADO_LIVRE' then case when upper(coalesce(l.account_code,''))='NOVO'
      then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end source
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id = l.marketplace_id cross join input i
  where l.listing_status = 'ACTIVE' and m.code in ('MERCADO_LIVRE','SHOPEE')
    and (i.platform='TODAS' or i.platform=m.code
      or (i.platform in ('ML_ANTIGO','ML_NOVO') and m.code='MERCADO_LIVRE'
        and upper(coalesce(l.account_code,''))=case when i.platform='ML_NOVO' then 'NOVO' else 'ANTIGO' end))
), variants as (
  select l.id listing_id, l.source, l.external_listing_id, l.title, l.url,
    lp.id listing_product_id, coalesce(nullif(lp.variation_name,''),nullif(lp.platform_sku,''),'Variação') variation_name,
    nullif(btrim(lp.platform_sku),'') sku, public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm,
    count(*) over (partition by l.id, public.commerce_nisti_sku_norm_v1(lp.platform_sku)) same_sku_count,
    case when l.source='SHOPEE' then exists(select 1 from public.commerce_shopee_sku_owner_reviewed_v1 o
        where o.listing_product_id=lp.id and o.listing_id=l.id
          and o.canonical_sku_norm=public.commerce_nisti_sku_norm_v1(lp.platform_sku))
      else true end verified_owner
  from listing_base l
  join public.commerce_listing_products lp on lp.listing_id = l.id
    and lp.relation_status not in ('REMOVED','INACTIVE')
), sources as (select distinct source from variants
), daily as materialized (
  select d.platform_code source, d.sale_date, d.external_listing_id,
    public.commerce_nisti_sku_norm_v1(d.sku_norm) norm, d.units
  from public.commerce_current_sales_listing_daily_v1 d
  where d.platform_code in (select source from sources)
), latest as (
  select s.source, max(d.sale_date) end_date from sources s left join daily d on d.source=s.source group by s.source
), coverage as (
  select l.source, l.end_date,
    l.end_date is not null and (
      select count(distinct gs::date) from public.commerce_sales_import_batches b
      join public.commerce_sales_import_stage_summary sm on sm.batch_id=b.id
      cross join lateral generate_series(greatest(sm.period_start,l.end_date-89), least(sm.period_end,l.end_date), interval '1 day') gs
      where b.platform_code=l.source and b.status='COMMITTED' and sm.period_start<=sm.period_end
        and sm.period_end>=l.end_date-89 and sm.period_start<=l.end_date) >= 90
    and (l.source<>'SHOPEE' or (select count(distinct d.sale_date) from daily d
      where d.source=l.source and d.sale_date between l.end_date-89 and l.end_date) >= 90) complete_90
  from latest l
), ad_sales as (
  select v.listing_id, coalesce(sum(d.units),0)::bigint ad_units_90
  from (select distinct listing_id, source, external_listing_id from variants) v
  join coverage c on c.source=v.source
  left join daily d on d.source=v.source and d.external_listing_id=v.external_listing_id
    and d.sale_date between c.end_date-89 and c.end_date
  group by v.listing_id
), var_sales as (
  select v.*, c.end_date, c.complete_90,
    (v.sku is not null and nullif(v.norm,'') is not null and v.same_sku_count=1 and v.verified_owner) verified,
    coalesce(sum(d.units) filter (where d.sale_date between c.end_date-89 and c.end_date),0)::bigint units_90,
    max(d.sale_date) filter (where d.units>0) last_sale_date
  from variants v join coverage c on c.source=v.source
  left join daily d on d.source=v.source and d.external_listing_id=v.external_listing_id and d.norm=v.norm
    and d.sale_date<=c.end_date
  group by v.listing_id, v.source, v.external_listing_id, v.title, v.url, v.listing_product_id,
    v.variation_name, v.sku, v.norm, v.same_sku_count, v.verified_owner, c.end_date, c.complete_90
), per_ad as (
  select listing_id, count(*) variation_count,
    count(*) filter (where verified and units_90>0) selling_variations,
    coalesce(sum(units_90) filter (where verified),0) verified_units_90,
    bool_and(verified) all_verified
  from var_sales group by listing_id
), candidates as (
  select v.*, a.ad_units_90, p.variation_count, p.selling_variations,
    case when v.last_sale_date is null then 'NEVER' else 'STOPPED' end kind
  from var_sales v join per_ad p on p.listing_id=v.listing_id join ad_sales a on a.listing_id=v.listing_id
  where v.verified and v.complete_90 and v.units_90=0
    and p.selling_variations>=1
    and a.ad_units_90 = p.verified_units_90   -- nenhuma venda do anúncio sem SKU atribuído
), page as (
  select * from candidates order by ad_units_90 desc, title, variation_name, listing_product_id
  limit (select page_size from input) offset (select page_offset from input)
)
select jsonb_build_object(
  'total', (select count(*) from candidates),
  'listings', (select count(distinct listing_id) from candidates),
  'never_sold', (select count(*) from candidates where kind='NEVER'),
  'stopped', (select count(*) from candidates where kind='STOPPED'),
  'coverage', coalesce((select jsonb_agg(jsonb_build_object('source',source,'end_date',end_date,'complete_90',complete_90)) from coverage),'[]'::jsonb),
  'items', coalesce((select jsonb_agg(jsonb_build_object(
    'listing_id',listing_id,'source',source,'external_listing_id',external_listing_id,'title',title,'url',url,
    'listing_product_id',listing_product_id,'variation_name',variation_name,'sku',sku,
    'kind',kind,'last_sale_date',last_sale_date,'end_date',end_date,
    'ad_units_90',ad_units_90,'variation_count',variation_count,'selling_variations',selling_variations)
    order by ad_units_90 desc, title, variation_name, listing_product_id) from page),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_variation_removal_candidates_v1(text,integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_variation_removal_candidates_v1(text,integer,integer) to service_role;
