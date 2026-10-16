-- Curva ABC: show actual active marketplace advertisements for each sold SKU.
-- Imported sales are by SKU; never duplicate that revenue as if it were measured per listing ID.
create or replace function public.commerce_sales_abc_ads_window_v1(
  p_platform text default 'TODAS',
  p_days integer default 30,
  p_reference_month text default null,
  p_basis text default 'REVENUE',
  p_class text default 'A',
  p_limit integer default 15,
  p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with inputs as (
  select upper(trim(coalesce(p_platform,'TODAS'))) platform,
    upper(trim(coalesce(p_class,'A'))) curve,
    greatest(1,least(coalesce(p_limit,15),50)) page_size,
    greatest(0,coalesce(p_offset,0)) page_offset,
    (public.commerce_sales_velocity_v2(p_days,p_platform,p_reference_month,'ALL',1,0)->>'current_start')::date start_date,
    (public.commerce_sales_velocity_v2(p_days,p_platform,p_reference_month,'ALL',1,0)->>'current_end')::date end_date
),
abc as (
  select public.commerce_sales_abc_window_v1(p_platform,p_days,p_reference_month,p_basis) result
), eligible as (
  select a.priority::integer priority,
    a.value->>'sku_norm' sku_norm,
    a.value->>'class' class_code,
    (a.value->>'units')::bigint units,
    (a.value->>'revenue')::numeric revenue
  from abc t
  cross join lateral jsonb_array_elements(coalesce(t.result->'items','[]'::jsonb))
    with ordinality as a(value,priority)
  where a.value->>'class'=(select curve from inputs)
), numbered as (
  select e.*,count(*) over() total_count from eligible e
), page as (
  select * from numbered
  order by priority
  limit (select page_size from inputs)
  offset (select page_offset from inputs)
), latest_import as (
  select distinct on (b.marketplace_id,b.account_code)
    b.id,b.marketplace_id,b.account_code
  from public.commerce_import_batches b
  order by b.marketplace_id,b.account_code,b.created_at desc,b.id desc
), source_matches as (
  select distinct on (p.sku_norm,l.id,
    coalesce(nullif(btrim(r.normalized_payload->>'source_variation_id'),''),''))
    p.sku_norm,
    l.id listing_id,
    nullif(btrim(r.normalized_payload->>'source_variation_id'),'') variation_id,
    nullif(btrim(r.normalized_payload->>'source_variation'),'') variation_name
  from page p
  join public.commerce_import_rows r
    on public.commerce_nisti_sku_norm_v1(r.normalized_payload->>'sku_primary')=p.sku_norm
   and r.normalized_payload->>'source_listing_status'='ACTIVE'
  join latest_import b on b.id=r.batch_id
  join public.commerce_listings l
    on l.marketplace_id=b.marketplace_id
   and l.account_code is not distinct from b.account_code
   and l.external_listing_id=r.normalized_payload->>'external_listing_id'
   and l.listing_status='ACTIVE'
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join inputs i
  where i.platform='TODAS'
     or (i.platform='MERCADO_LIVRE' and m.code='MERCADO_LIVRE')
     or (i.platform='ML_ANTIGO' and m.code='MERCADO_LIVRE'
       and upper(coalesce(l.account_code,'')) in ('ANTIGO','ML_ANTIGO'))
     or (i.platform='ML_NOVO' and m.code='MERCADO_LIVRE'
       and upper(coalesce(l.account_code,'')) in ('NOVO','ML_NOVO'))
     or (i.platform=m.code)
  order by p.sku_norm,l.id,
    coalesce(nullif(btrim(r.normalized_payload->>'source_variation_id'),''),''),
    r.row_number
), linked_matches as (
  select distinct p.sku_norm,l.id listing_id
  from page p
  join public.commerce_listing_products lp
    on public.commerce_nisti_sku_norm_v1(lp.platform_sku)=p.sku_norm
   and lp.relation_status<>'REMOVED'
  join public.commerce_listings l on l.id=lp.listing_id and l.listing_status='ACTIVE'
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  cross join inputs i
  where i.platform='TODAS'
    or (i.platform='MERCADO_LIVRE' and m.code='MERCADO_LIVRE')
    or (i.platform='ML_ANTIGO' and m.code='MERCADO_LIVRE'
      and upper(coalesce(l.account_code,'')) in ('ANTIGO','ML_ANTIGO'))
    or (i.platform='ML_NOVO' and m.code='MERCADO_LIVRE'
      and upper(coalesce(l.account_code,'')) in ('NOVO','ML_NOVO'))
    or (i.platform=m.code)
), ad_ids as (
  select sku_norm,listing_id from source_matches
  union
  select sku_norm,listing_id from linked_matches
), variation_details as (
  select d.sku_norm,d.listing_id,
    jsonb_agg(jsonb_build_object('id',d.variation_id,'name',
      coalesce(nullif(d.variation_name,'-'),'Variação '||d.variation_id))
      order by d.variation_name,d.variation_id) variations
  from source_matches d
  where d.variation_id is not null
  group by d.sku_norm,d.listing_id
), ad_records as (
  select ids.sku_norm,
    l.external_listing_id,l.title,l.account_code,
    m.code marketplace_code,m.name marketplace_name,
    coalesce(nullif(btrim(l.canonical_url),''),nullif(btrim(l.source_url),'')) url,
    cover.cover_image_url,
    coalesce(v.variations,'[]'::jsonb) variations,
    manual.manual_units,
    sold.imported_units,
    sold.imported_revenue
  from ad_ids ids
  join public.commerce_listings l on l.id=ids.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  left join variation_details v
    on v.sku_norm=ids.sku_norm and v.listing_id=ids.listing_id
  left join lateral (
    select nullif(btrim(s.cover_image_url),'') cover_image_url
    from public.commerce_marketplace_snapshots s
    where s.listing_id=l.id
      and nullif(btrim(s.cover_image_url),'') is not null
    order by s.ingested_at desc,s.id desc
    limit 1
  ) cover on true
  left join lateral (
    select null::bigint manual_units
  ) manual on true
  left join lateral (
    select sum(s.units)::bigint imported_units,
      round(sum(s.product_revenue),2) imported_revenue
    from public.commerce_current_sales_listing_daily_v1 s
    cross join inputs i
    where s.external_listing_id=l.external_listing_id
      and s.sku_norm=ids.sku_norm
      and (i.platform='TODAS'
        or (i.platform='MERCADO_LIVRE' and s.platform_code in ('ML_ANTIGO','ML_NOVO'))
        or s.platform_code=i.platform)
      and s.sale_date between i.start_date and i.end_date
  ) sold on true
), ad_groups as (
  select sku_norm,
    jsonb_agg(jsonb_build_object(
      'id',external_listing_id,
      'title',title,
      'account_code',account_code,
      'marketplace_code',marketplace_code,
      'marketplace_name',marketplace_name,
      'url',url,
      'variations',variations,
      'manual_units',manual_units,
      'imported_units',imported_units,
      'imported_revenue',imported_revenue
    ) order by marketplace_code,account_code,external_listing_id) advertisements,
    (array_agg(cover_image_url order by (cover_image_url is not null) desc)
     filter(where cover_image_url is not null))[1] image_url,
    (array_agg(title order by (title is not null) desc)
     filter(where title is not null))[1] product_name
  from ad_records
  group by sku_norm
), rows as (
  select p.*,
    coalesce(a.advertisements,'[]'::jsonb) advertisements,
    a.image_url,
    coalesce(a.product_name,p.sku_norm) product_name,
    coalesce(jsonb_array_length(a.advertisements),0) advertisement_count
  from page p
  left join ad_groups a on a.sku_norm=p.sku_norm
)
select jsonb_build_object(
  'curve',(select curve from inputs),
  'basis',upper(trim(coalesce(p_basis,'REVENUE'))),
  'has_sales',(select result->>'has_sales'='true' from abc),
  'total',coalesce((select max(total_count) from numbered),0),
  'limit',(select page_size from inputs),
  'offset',(select page_offset from inputs),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'sku_norm',r.sku_norm,
    'product_name',r.product_name,
    'image_url',r.image_url,
    'units',r.units,
    'revenue',r.revenue,
    'advertisements',r.advertisements,
    'advertisement_count',r.advertisement_count
  ) order by r.priority) from rows r),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_abc_ads_window_v1(text,integer,text,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_sales_abc_ads_window_v1(text,integer,text,text,text,integer,integer)
  to service_role;
