CREATE OR REPLACE FUNCTION public.commerce_management_detail_v1(p_source_row_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with selected as (
  select
    r.id as source_row_id,
    r.matched_product_id as product_id,
    coalesce(
      nullif(btrim(r.normalized_payload->>'sku'),''),
      nullif(btrim(r.normalized_payload->>'sku_base'),''),
      nullif(btrim(r.normalized_payload->>'sku_primary'),'')
    ) as sku,
    regexp_replace(
      upper(btrim(coalesce(
        nullif(r.normalized_payload->>'sku',''),
        nullif(r.normalized_payload->>'sku_base',''),
        nullif(r.normalized_payload->>'sku_primary',''),
        ''
      ))),
      '[^A-Z0-9]+','','g'
    ) as sku_norm
  from public.commerce_source_rows r
  where r.id=p_source_row_id
),
ops(source_code, label, sort_order) as (
  values
    ('SHOPEE','Shopee',1),
    ('ML_NOVO','ML Novo',2),
    ('ML_ANTIGO','ML Antigo',3),
    ('AMAZON','Amazon',4),
    ('SHEIN','Shein',5),
    ('LOJA_INTEGRADA','Loja Integrada',6),
    ('KWAI','Kwai',7),
    ('TIKTOK','TikTok',8),
    ('ALIEXPRESS','AliExpress',9),
    ('MAGALU','Magalu',10)
),
latest_files as (
  select
    o.source_code,
    o.label,
    o.sort_order,
    lf.id as source_file_id
  from ops o
  left join lateral (
    select f.id
    from public.commerce_source_files f
    where upper(f.source_code) in (o.source_code, o.source_code||'_GESTAO')
    order by
      case when upper(f.source_code)=o.source_code||'_GESTAO' then 0 else 1 end,
      f.imported_at desc nulls last,
      f.id desc
    limit 1
  ) lf on true
),
matches as (
  select
    lf.source_code,
    lf.label,
    lf.sort_order,
    r.id as source_row_id,
    r.matched_product_id as product_id,
    coalesce(
      nullif(btrim(r.normalized_payload->>'sku'),''),
      nullif(btrim(r.normalized_payload->>'sku_base'),''),
      nullif(btrim(r.normalized_payload->>'sku_primary'),'')
    ) as sku,
    nullif(btrim(r.normalized_payload->>'product_name'),'') as product_name,
    nullif(btrim(r.normalized_payload->>'category'),'') as category_name,
    nullif(btrim(r.normalized_payload->>'listing_url'),'') as listing_url,
    coalesce(
      nullif(btrim(r.normalized_payload->>'updated'),''),
      nullif(btrim(r.normalized_payload->>'update_hint'),'')
    ) as update_raw,
    coalesce(
      nullif(btrim(r.normalized_payload->>'video'),''),
      nullif(btrim(r.normalized_payload->>'video_status'),'')
    ) as video_raw,
    r.resolution_status
  from latest_files lf
  join public.commerce_source_rows r
    on r.source_file_id=lf.source_file_id
   and r.is_header=false
  cross join selected s
  where
    (s.product_id is not null and r.matched_product_id=s.product_id)
    or (
      s.product_id is null
      and regexp_replace(
        upper(btrim(coalesce(
          nullif(r.normalized_payload->>'sku',''),
          nullif(r.normalized_payload->>'sku_base',''),
          nullif(r.normalized_payload->>'sku_primary',''),
          ''
        ))),
        '[^A-Z0-9]+','','g'
      )=s.sku_norm
      and s.sku_norm<>''
    )
),
normalized_matches as (
  select
    m.*,
    case
      when upper(btrim(coalesce(m.update_raw,''))) in ('UPDATED','S','SIM','FULL','SM') then 'UPDATED'
      when upper(btrim(coalesce(m.update_raw,''))) in ('NOT_UPDATED','N','NAO','NÃO') then 'NOT_UPDATED'
      when upper(btrim(coalesce(m.update_raw,''))) in ('REVIEW','REVISAR') then 'REVIEW'
      when upper(btrim(coalesce(m.update_raw,''))) in ('NOT_LISTED','NAO CADASTRADO','NÃO CADASTRADO') then 'NOT_LISTED'
      when nullif(btrim(coalesce(m.update_raw,'')),'') is null then 'NO_DATA'
      else 'REVIEW'
    end as update_status,
    case
      when upper(btrim(coalesce(m.video_raw,''))) in ('ACTIVE','S','SIM') then 'ACTIVE'
      when upper(btrim(coalesce(m.video_raw,''))) in ('ABSENT','N','NAO','NÃO') then 'ABSENT'
      when upper(btrim(coalesce(m.video_raw,''))) in ('DISABLED','S/D') then 'DISABLED'
      when nullif(btrim(coalesce(m.video_raw,'')),'') is null then 'NO_DATA'
      else 'UNKNOWN'
    end as video_status,
    case
      when m.product_id is not null and m.resolution_status in ('LISTING_MATCHED','PRODUCT_MATCHED') then 'CONFIRMED'
      when m.resolution_status='REFERENCE_ONLY' then 'REVIEW'
      else 'UNMATCHED'
    end as relation_status
  from matches m
),
platforms as (
  select
    source_code,
    label,
    min(sort_order) as sort_order,
    jsonb_agg(
      jsonb_build_object(
        'source_row_id', source_row_id,
        'sku', sku,
        'product_name', product_name,
        'category_name', category_name,
        'listing_url', listing_url,
        'update_status', update_status,
        'video_status', video_status,
        'relation_status', relation_status
      )
      order by source_row_id
    ) as items,
    count(*) as item_count
  from normalized_matches
  group by source_code,label
)
select jsonb_build_object(
  'source_row_id', s.source_row_id,
  'product_id', s.product_id,
  'selected_sku', s.sku,
  'product', case when cp.id is null then null else jsonb_build_object(
    'id', cp.id,
    'name', cp.name,
    'current_sku', cps.sku,
    'edition_year', cp.edition_year,
    'category_name', cc.name
  ) end,
  'platforms', coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'source_code', p.source_code,
        'label', p.label,
        'item_count', p.item_count,
        'items', p.items
      )
      order by p.sort_order
    )
    from platforms p
  ), '[]'::jsonb)
)
from selected s
left join public.commerce_products cp on cp.id=s.product_id
left join public.commerce_categories cc on cc.id=cp.category_id
left join lateral (
  select ps.sku
  from public.commerce_product_skus ps
  where ps.product_id=cp.id
  order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end, ps.id
  limit 1
) cps on true;
$function$;
revoke execute on function public.commerce_management_detail_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_management_detail_v1(bigint) to service_role;
