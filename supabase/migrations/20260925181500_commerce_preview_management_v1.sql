do $$
declare
  src record;
  new_file_id bigint;
begin
  delete from public.commerce_preview_source_rows
  where source_file_id in (
    select id from public.commerce_preview_source_files
    where source_code like '%\\_GESTAO' escape '\\'
  );
  delete from public.commerce_preview_source_files
  where source_code like '%\\_GESTAO' escape '\\';

  for src in
    select distinct on (source_code) *
    from public.commerce_source_files
    where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
    order by source_code, imported_at desc nulls last, id desc
  loop
    insert into public.commerce_preview_source_files(
      source_code,source_name,source_kind,marketplace_code,account_code,
      source_filename,source_sha256,source_modified_at,row_count,metadata,
      imported_at,mime_type,byte_size,source_blob
    )
    values(
      src.source_code,src.source_name,src.source_kind,src.marketplace_code,src.account_code,
      src.source_filename,src.source_sha256,src.source_modified_at,src.row_count,
      coalesce(src.metadata,'{}'::jsonb) || jsonb_build_object('preview_snapshot',true,'copied_from_live_source_file_id',src.id),
      now(),src.mime_type,src.byte_size,src.source_blob
    )
    returning id into new_file_id;

    insert into public.commerce_preview_source_rows(
      source_file_id,sheet_name,row_number,is_header,original_payload,normalized_payload,
      matched_product_id,matched_listing_id,resolution_status,notes,imported_at
    )
    select
      new_file_id,r.sheet_name,r.row_number,r.is_header,r.original_payload,r.normalized_payload,
      r.matched_product_id,r.matched_listing_id,r.resolution_status,
      coalesce(r.notes,'') || ' · snapshot preview',now()
    from public.commerce_source_rows r
    where r.source_file_id=src.id;
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_rows_v1(p_source_code text DEFAULT 'AMAZON'::text, p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_update_status text DEFAULT NULL::text, p_video_status text DEFAULT NULL::text, p_listing_status text DEFAULT NULL::text, p_image_status text DEFAULT NULL::text, p_relation_status text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(source_row_id bigint, source_code text, source_name text, source_file_id bigint, source_filename text, source_row_number integer, product_id bigint, listing_id bigint, sku text, product_name text, category_name text, edition_year integer, update_status text, video_status text, listing_status text, relation_status text, listing_url text, image_url text, image_source text, image_source_marketplace_code text, image_source_marketplace_name text, image_source_sku text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with target_source as (
  select case
    when exists (
      select 1 from public.commerce_preview_source_files sf
      where upper(sf.source_code)=upper(btrim(coalesce(p_source_code,''))) || '_GESTAO'
    )
      then upper(btrim(coalesce(p_source_code,''))) || '_GESTAO'
    else upper(btrim(coalesce(p_source_code,'')))
  end as code
),
latest_file as (
  select f.*
  from public.commerce_preview_source_files f
  where upper(f.source_code)=(select code from target_source)
  order by f.imported_at desc nulls last, f.id desc
  limit 1
),
base as (
  select
    r.id as source_row_id,
    upper(btrim(coalesce(p_source_code,''))) as source_code,
    f.source_name,
    f.id as source_file_id,
    f.source_filename,
    r.row_number as source_row_number,
    r.matched_product_id as product_id,
    r.matched_listing_id as listing_id,
    r.resolution_status,
    r.normalized_payload,
    nullif(btrim(r.normalized_payload->>'observation'),'') as observation_text,
    nullif(btrim(r.normalized_payload->>'linked_image_url'),'') as curated_image_url,
    nullif(btrim(r.normalized_payload->>'linked_image_reference'),'') as curated_image_reference,
    coalesce(
      nullif(btrim(r.normalized_payload->>'sku'),''),
      nullif(btrim(r.normalized_payload->>'sku_primary'),''),
      nullif(btrim(r.normalized_payload->>'sku_base'),''),
      nullif(btrim(r.normalized_payload->>'sku_secondary'),'')
    ) as source_sku,
    coalesce(nullif(btrim(r.normalized_payload->>'product_name'),''),nullif(btrim(cp.name),'')) as source_product_name,
    coalesce(nullif(btrim(r.normalized_payload->>'category'),''),nullif(btrim(cc.name),'')) as source_category,
    coalesce(nullif(btrim(r.normalized_payload->>'listing_url'),''),nullif(btrim(cl.canonical_url),'')) as source_listing_url,
    cl.listing_status as linked_listing_status,
    nullif(btrim(r.normalized_payload->>'observed_year'),'') as observed_year_text,
    cp.edition_year as product_edition_year,
    coalesce(nullif(btrim(r.normalized_payload->>'updated'),''),nullif(btrim(r.normalized_payload->>'update_hint'),'')) as update_raw,
    coalesce(nullif(btrim(r.normalized_payload->>'video'),''),nullif(btrim(r.normalized_payload->>'video_status'),'')) as video_raw
  from latest_file f
  join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
  left join public.commerce_preview_products cp on cp.id=r.matched_product_id
  left join public.commerce_preview_categories cc on cc.id=cp.category_id
  left join public.commerce_preview_listings cl on cl.id=r.matched_listing_id
),
normalized as (
  select b.*,
    coalesce(
      public.commerce_sku_edition_year(b.source_sku),
      case when b.observed_year_text ~ '^[0-9]{4}$' then b.observed_year_text::integer end,
      public.commerce_text_edition_year(b.source_product_name),
      b.product_edition_year
    ) as resolved_year,
    case
      when upper(btrim(coalesce(b.update_raw,''))) in ('UPDATED','S','SIM','FULL','SM') then 'UPDATED'
      when upper(btrim(coalesce(b.update_raw,''))) in ('NOT_UPDATED','N','NAO','NÃO') then 'NOT_UPDATED'
      when upper(btrim(coalesce(b.update_raw,''))) in ('REVIEW','REVISAR') then 'REVIEW'
      when upper(btrim(coalesce(b.update_raw,''))) in ('NOT_LISTED','NAO CADASTRADO','NÃO CADASTRADO') then 'NOT_LISTED'
      when nullif(btrim(coalesce(b.update_raw,'')),'') is null then 'NO_DATA'
      else 'REVIEW'
    end as normalized_update_status,
    case
      when upper(btrim(coalesce(b.video_raw,''))) in ('ACTIVE','S','SIM') then 'ACTIVE'
      when upper(btrim(coalesce(b.video_raw,''))) in ('ABSENT','N','NAO','NÃO') then 'ABSENT'
      when upper(btrim(coalesce(b.video_raw,''))) in ('DISABLED','S/D') then 'DISABLED'
      when nullif(btrim(coalesce(b.video_raw,'')),'') is null then 'NO_DATA'
      else 'UNKNOWN'
    end as normalized_video_status,
    case
      when b.linked_listing_status is not null then b.linked_listing_status
      when upper(btrim(coalesce(b.update_raw,''))) in ('NOT_LISTED','NAO CADASTRADO','NÃO CADASTRADO') then 'NO_LISTING'
      when upper(coalesce(b.observation_text,'')) like '%IN STOCK%' then 'ACTIVE'
      else 'UNVERIFIED'
    end as normalized_listing_status,
    case
      when b.product_id is not null and b.resolution_status in ('LISTING_MATCHED','PRODUCT_MATCHED') then 'CONFIRMED'
      when b.resolution_status='REFERENCE_ONLY' then 'REVIEW'
      else 'UNMATCHED'
    end as normalized_relation_status
  from base b
),
resolved as (
  select n.*,
    coalesce(n.curated_image_url,direct_image.image_url,inherited_image.image_url,nisti_image.image_url) as resolved_image_url,
    case when n.curated_image_url is not null then 'OTHER_MARKETPLACE'
         when direct_image.image_url is not null then 'MARKETPLACE'
         when inherited_image.image_url is not null then 'OTHER_MARKETPLACE'
         when nisti_image.image_url is not null then 'NISTI_ID' else null end as resolved_image_source,
    case when n.curated_image_url is not null then
           case
             when upper(coalesce(n.curated_image_reference,'')) like '%SHOPEE%' then 'SHOPEE'
             when upper(coalesce(n.curated_image_reference,'')) like '%SHEIN%' then 'SHEIN'
             when upper(coalesce(n.curated_image_reference,'')) like '%ML NOVO%' then 'ML_NOVO'
             when upper(coalesce(n.curated_image_reference,'')) like '%ML ANTIGO%' then 'ML_ANTIGO'
             else 'CURATED'
           end
         when direct_image.image_url is not null then direct_image.marketplace_code
         when inherited_image.image_url is not null then inherited_image.marketplace_code else null end as resolved_image_marketplace_code,
    case when n.curated_image_url is not null then
           case
             when upper(coalesce(n.curated_image_reference,'')) like '%SHOPEE%' then 'Shopee'
             when upper(coalesce(n.curated_image_reference,'')) like '%SHEIN%' then 'Shein'
             when upper(coalesce(n.curated_image_reference,'')) like '%ML NOVO%' then 'Mercado Livre Novo'
             when upper(coalesce(n.curated_image_reference,'')) like '%ML ANTIGO%' then 'Mercado Livre Antigo'
             else 'Gestão'
           end
         when direct_image.image_url is not null then direct_image.marketplace_name
         when inherited_image.image_url is not null then inherited_image.marketplace_name else null end as resolved_image_marketplace_name,
    case when n.curated_image_url is not null then n.source_sku
         when direct_image.image_url is not null then direct_image.platform_sku
         when inherited_image.image_url is not null then inherited_image.platform_sku
         when nisti_image.image_url is not null then nisti_image.matched_sku else null end as resolved_image_sku
  from normalized n
  left join lateral (
    select coalesce(option_image.image_url,s.cover_image_url) as image_url,m.code as marketplace_code,m.name as marketplace_name,lp.platform_sku
    from public.commerce_preview_listings l
    join public.commerce_preview_marketplaces m on m.id=l.marketplace_id
    join public.commerce_preview_listing_products lp on lp.listing_id=l.id and lp.relation_status<>'REMOVED' and (n.product_id is null or lp.product_id=n.product_id)
    join lateral (
      select ms.* from public.commerce_preview_marketplace_snapshots ms
      where ms.listing_id=l.id and ms.match_status='MATCHED'
      order by ms.ingested_at desc,ms.id desc limit 1
    ) s on true
    left join lateral (
      select nullif(btrim(opt->>'image_url'),'') as image_url
      from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) opt
      where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
        and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))=lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
        and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
      limit 1
    ) option_image on true
    where n.listing_id is not null and l.id=n.listing_id
      and nullif(btrim(coalesce(coalesce(option_image.image_url,s.cover_image_url),'')),'') is not null
      and public.commerce_image_years_compatible(n.source_sku,lp.platform_sku,case when upper(m.code)='SHOPEE' then coalesce(s.title,l.title) else null end)
    order by case when option_image.image_url is not null then 0 else 1 end,s.ingested_at desc,s.id desc
    limit 1
  ) direct_image on n.curated_image_url is null
  left join lateral (
    select coalesce(option_image.image_url,s.cover_image_url) as image_url,m.code as marketplace_code,m.name as marketplace_name,lp.platform_sku
    from public.commerce_preview_listing_products lp
    join public.commerce_preview_listings l on l.id=lp.listing_id and l.listing_status<>'REMOVED'
    join public.commerce_preview_marketplaces m on m.id=l.marketplace_id
    join lateral (
      select ms.* from public.commerce_preview_marketplace_snapshots ms
      where ms.listing_id=l.id and ms.match_status='MATCHED'
      order by ms.ingested_at desc,ms.id desc limit 1
    ) s on true
    left join lateral (
      select nullif(btrim(opt->>'image_url'),'') as image_url
      from jsonb_array_elements(coalesce(s.variation_options,'[]'::jsonb)) opt
      where nullif(btrim(coalesce(lp.variation_name,'')),'') is not null
        and lower(regexp_replace(btrim(coalesce(opt->>'name','')),'[^a-zA-Z0-9]+','','g'))=lower(regexp_replace(btrim(coalesce(lp.variation_name,'')),'[^a-zA-Z0-9]+','','g'))
        and nullif(btrim(coalesce(opt->>'image_url','')),'') is not null
      limit 1
    ) option_image on true
    where n.product_id is not null and lp.product_id=n.product_id and lp.relation_status<>'REMOVED'
      and (n.listing_id is null or lp.listing_id<>n.listing_id)
      and public.commerce_image_years_compatible(n.source_sku,lp.platform_sku,case when upper(m.code)='SHOPEE' then coalesce(s.title,l.title) else null end)
      and nullif(btrim(coalesce(coalesce(option_image.image_url,s.cover_image_url),'')),'') is not null
    order by
      case when upper(m.code)=case when upper(n.source_code) in ('ML_NOVO','ML_ANTIGO') then 'MERCADO_LIVRE' else upper(n.source_code) end then 0 else 1 end,
      case when option_image.image_url is not null then 0 else 1 end,
      s.ingested_at desc,s.id desc,l.id
    limit 1
  ) inherited_image on n.curated_image_url is null and direct_image.image_url is null
  left join lateral (
    select '/api/images/'||media.source_product_id::text as image_url,media.matched_sku
    from public.commerce_preview_product_media_links media
    where n.product_id is not null and media.product_id=n.product_id and media.source_kind='NISTI_ID'
      and media.source_product_id is not null
      and public.commerce_image_years_compatible(n.source_sku,media.matched_sku,null)
    order by media.id limit 1
  ) nisti_image on n.curated_image_url is null and direct_image.image_url is null and inherited_image.image_url is null
)
select
  r.source_row_id,r.source_code,r.source_name,r.source_file_id,r.source_filename,r.source_row_number,
  r.product_id,r.listing_id,r.source_sku,r.source_product_name,r.source_category,r.resolved_year,
  r.normalized_update_status,r.normalized_video_status,r.normalized_listing_status,r.normalized_relation_status,
  r.source_listing_url,r.resolved_image_url,r.resolved_image_source,r.resolved_image_marketplace_code,
  r.resolved_image_marketplace_name,r.resolved_image_sku,count(*) over()
from resolved r
where
  (nullif(btrim(coalesce(p_search,'')),'') is null or coalesce(r.source_sku,'') ilike '%'||btrim(p_search)||'%' or coalesce(r.source_product_name,'') ilike '%'||btrim(p_search)||'%' or coalesce(r.source_listing_url,'') ilike '%'||btrim(p_search)||'%')
  and (nullif(btrim(coalesce(p_category,'')),'') is null or upper(coalesce(r.source_category,''))=upper(btrim(p_category)))
  and (nullif(btrim(coalesce(p_update_status,'')),'') is null or r.normalized_update_status=upper(btrim(p_update_status)))
  and (nullif(btrim(coalesce(p_video_status,'')),'') is null or r.normalized_video_status=upper(btrim(p_video_status)))
  and (nullif(btrim(coalesce(p_listing_status,'')),'') is null or r.normalized_listing_status=upper(btrim(p_listing_status)))
  and (
    nullif(btrim(coalesce(p_relation_status,'')),'') is null
    or (
      upper(btrim(p_relation_status))='NEEDS_REVIEW'
      and (
        r.normalized_relation_status <> 'CONFIRMED'
        or r.normalized_update_status in ('REVIEW','NO_DATA')
      )
    )
    or r.normalized_relation_status=upper(btrim(p_relation_status))
  )
  and (p_year is null or r.resolved_year=p_year)
  and (
    nullif(btrim(coalesce(p_image_status,'')),'') is null
    or (upper(btrim(p_image_status))='WITH_IMAGE' and r.resolved_image_url is not null)
    or (upper(btrim(p_image_status))='WITHOUT_IMAGE' and r.resolved_image_url is null)
    or r.resolved_image_source=upper(btrim(p_image_status))
  )
order by
  case
    when r.resolved_image_url is null
      or r.source_listing_url is null
      or r.normalized_relation_status='UNMATCHED'
      or r.normalized_update_status='NOT_UPDATED'
      or r.normalized_listing_status in ('NO_LISTING','REMOVED','INACTIVE')
      then 0
    when r.normalized_relation_status='REVIEW'
      or r.normalized_update_status in ('REVIEW','NO_DATA')
      or r.normalized_video_status in ('UNKNOWN','NO_DATA','DISABLED')
      or r.normalized_listing_status='UNVERIFIED'
      then 1
    else 2
  end,
  r.source_row_number,
  r.source_row_id
limit least(greatest(coalesce(p_limit,50),1),100)
offset greatest(coalesce(p_offset,0),0);
$function$;
revoke execute on function public.commerce_preview_management_rows_v1(text,text,text,text,text,text,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_rows_v1(text,text,text,text,text,text,text,text,integer,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_detail_v1(p_source_row_id bigint)
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
  from public.commerce_preview_source_rows r
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
    from public.commerce_preview_source_files f
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
  join public.commerce_preview_source_rows r
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
left join public.commerce_preview_products cp on cp.id=s.product_id
left join public.commerce_preview_categories cc on cc.id=cp.category_id
left join lateral (
  select ps.sku
  from public.commerce_preview_product_skus ps
  where ps.product_id=cp.id
  order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end, ps.id
  limit 1
) cps on true;
$function$;
revoke execute on function public.commerce_preview_management_detail_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_detail_v1(bigint) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_summary_v1(p_source_code text DEFAULT 'AMAZON'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with first_page as (
  select *
  from public.commerce_preview_management_rows_v1(
    p_source_code,null,null,null,null,null,null,null,null,100,0
  )
),
meta as (
  select coalesce(max(total_count),0)::integer as total
  from first_page
),
rest_pages as (
  select r.*
  from meta m
  cross join lateral generate_series(100, greatest(m.total - 1, 0), 100) as offsets(page_offset)
  cross join lateral public.commerce_preview_management_rows_v1(
    p_source_code,null,null,null,null,null,null,null,null,100,offsets.page_offset
  ) r
),
all_rows as (
  select * from first_page
  union all
  select * from rest_pages
)
select jsonb_build_object(
  'total', count(*),
  'with_image', count(*) filter (where image_url is not null),
  'without_image', count(*) filter (where image_url is null),
  'updated', count(*) filter (where update_status='UPDATED'),
  'not_updated', count(*) filter (where update_status='NOT_UPDATED'),
  'update_review', count(*) filter (where update_status in ('REVIEW','NO_DATA')),
  'with_video', count(*) filter (where video_status='ACTIVE'),
  'without_video', count(*) filter (where video_status='ABSENT'),
  'video_review', count(*) filter (where video_status in ('UNKNOWN','NO_DATA','DISABLED')),
  'confirmed', count(*) filter (where relation_status='CONFIRMED'),
  'relation_review', count(*) filter (where relation_status='REVIEW'),
  'unmatched', count(*) filter (where relation_status='UNMATCHED'),
  'active', count(*) filter (where listing_status='ACTIVE'),
  'verify', count(*) filter (
    where relation_status <> 'CONFIRMED'
       or update_status in ('REVIEW','NO_DATA')
  )
)
from all_rows;
$function$;
revoke execute on function public.commerce_preview_management_summary_v1(text) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_summary_v1(text) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_filter_options_v1(p_source_code text DEFAULT 'AMAZON'::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with first_page as (
  select * from public.commerce_preview_management_rows_v1(
    p_source_code,null,null,null,null,null,null,null,null,100,0
  )
),
meta as (
  select coalesce(max(total_count),0)::integer as total from first_page
),
rest_pages as (
  select r.*
  from meta m
  cross join lateral generate_series(100,greatest(m.total-1,0),100) offsets(page_offset)
  cross join lateral public.commerce_preview_management_rows_v1(
    p_source_code,null,null,null,null,null,null,null,null,100,offsets.page_offset
  ) r
),
all_rows as (
  select * from first_page
  union all
  select * from rest_pages
)
select jsonb_build_object(
  'categories', coalesce((
    select jsonb_agg(x.category_name order by x.category_name)
    from (
      select distinct category_name
      from all_rows
      where nullif(btrim(coalesce(category_name,'')),'') is not null
    ) x
  ), '[]'::jsonb),
  'years', coalesce((
    select jsonb_agg(x.edition_year order by x.edition_year desc)
    from (
      select distinct edition_year
      from all_rows
      where edition_year is not null
    ) x
  ), '[]'::jsonb),
  'listing_statuses', coalesce((
    select jsonb_agg(x.listing_status order by x.listing_status)
    from (
      select distinct listing_status
      from all_rows
      where nullif(btrim(coalesce(listing_status,'')),'') is not null
    ) x
  ), '[]'::jsonb)
);
$function$;
revoke execute on function public.commerce_preview_management_filter_options_v1(text) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_filter_options_v1(text) to service_role;

