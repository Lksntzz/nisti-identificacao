-- GS image fallback is preview-only. It reads GS_REFERENCIA when present and never overwrites marketplace data.

CREATE OR REPLACE FUNCTION public.commerce_preview_management_products_v2(p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_presence text DEFAULT 'LINKED'::text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS TABLE(card_key text, product_id bigint, product_name text, master_sku text, category_name text, edition_year integer, image_url text, platform_count integer, presence_type text, platforms jsonb, link_review_status text, suggested_product_id bigint, candidate_count integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with sources(code,label,sort_order) as (
  values
    ('SHOPEE','Shopee',1),
    ('ML_NOVO','ML Novo',2),
    ('ML_ANTIGO','ML Antigo',3),
    ('AMAZON','Amazon',4),
    ('SHEIN','Shein',5)
),
first_pages as (
  select s.code,s.label,s.sort_order,r.*
  from sources s
  cross join lateral public.commerce_preview_management_rows_v2(
    s.code,null,null,null,null,null,null,null,null,100,0
  ) r
),
source_totals as (
  select code,label,sort_order,coalesce(max(total_count),0)::integer as total
  from first_pages
  group by code,label,sort_order
),
rest_pages as (
  select st.code,st.label,st.sort_order,r.*
  from source_totals st
  cross join lateral generate_series(100,greatest(st.total-1,0),100) offsets(page_offset)
  cross join lateral public.commerce_preview_management_rows_v2(
    st.code,null,null,null,null,null,null,null,null,100,offsets.page_offset
  ) r
),
all_rows as (
  select * from first_pages
  union all
  select * from rest_pages
),
matched_platforms as (
  select
    ar.product_id,
    ar.code as source_code,
    ar.label as platform_label,
    min(ar.sort_order) as sort_order,
    count(*)::integer as item_count,
    jsonb_agg(
      jsonb_build_object(
        'source_row_id',ar.source_row_id,'source_code',ar.code,'label',ar.label,'sku',ar.sku,
        'product_name',ar.product_name,'category_name',ar.category_name,'edition_year',ar.edition_year,
        'update_status',ar.update_status,'video_status',ar.video_status,'listing_status',ar.listing_status,
        'relation_status',ar.relation_status,'listing_url',ar.listing_url,'image_url',ar.image_url,
        'image_source',ar.image_source,'image_source_marketplace_name',ar.image_source_marketplace_name,
        'image_source_sku',ar.image_source_sku
      )
      order by ar.source_row_number,ar.source_row_id
    ) as items
  from all_rows ar
  where ar.product_id is not null
  group by ar.product_id,ar.code,ar.label
),
linked_base as (
  select
    mp.product_id,cp.name as product_name,cps.sku as master_sku,cc.name as category_name,cp.edition_year,
    count(*)::integer as platform_count,
    case when count(*) >= 2 then 'MULTI' else 'EXCLUSIVE' end as presence_type,
    jsonb_agg(jsonb_build_object('source_code',mp.source_code,'label',mp.platform_label,'item_count',mp.item_count,'items',mp.items) order by mp.sort_order) as platforms
  from matched_platforms mp
  join public.commerce_preview_products cp on cp.id=mp.product_id
  left join public.commerce_preview_categories cc on cc.id=cp.category_id
  left join lateral (
    select ps.sku
    from public.commerce_preview_product_skus ps
    where ps.product_id=cp.id
    order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end,ps.id
    limit 1
  ) cps on true
  group by mp.product_id,cp.name,cps.sku,cc.name,cp.edition_year
),
linked_cards as (
  select
    'PRODUCT:'||lb.product_id::text as card_key,lb.product_id,lb.product_name,lb.master_sku,lb.category_name,lb.edition_year,
    (
      select item->>'image_url'
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
      where nullif(item->>'image_url','') is not null
      order by case when (item->>'edition_year') ~ '^[0-9]+$' and (item->>'edition_year')::integer=lb.edition_year then 0 else 1 end,
               case p->>'source_code' when 'SHOPEE' then 1 when 'ML_NOVO' then 2 when 'ML_ANTIGO' then 3 when 'AMAZON' then 4 when 'SHEIN' then 5 else 9 end
      limit 1
    ) as image_url,
    lb.platform_count,lb.presence_type,lb.platforms,
    'LINKED'::text as link_review_status,null::bigint as suggested_product_id,0::integer as candidate_count,
    concat_ws(' ',lb.product_name,lb.master_sku,(
      select string_agg(item->>'sku',' ')
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
    )) as search_text
  from linked_base lb
),
unlinked_candidates as (
  select
    u.source_row_id,
    count(distinct l.product_id)::integer as candidate_count,
    min(l.product_id)::bigint as suggested_product_id
  from all_rows u
  left join all_rows l
    on l.product_id is not null
   and lower(regexp_replace(btrim(coalesce(l.product_name,'')),'[^[:alnum:]]+','','g'))
       = lower(regexp_replace(btrim(coalesce(u.product_name,'')),'[^[:alnum:]]+','','g'))
   and lower(regexp_replace(btrim(coalesce(u.product_name,'')),'[^[:alnum:]]+','','g')) <> ''
   and upper(btrim(coalesce(l.category_name,'')))=upper(btrim(coalesce(u.category_name,'')))
   and coalesce(l.edition_year,-1)=coalesce(u.edition_year,-1)
  where u.product_id is null
  group by u.source_row_id
),
unlinked_cards as (
  select
    'ROW:'||ar.source_row_id::text as card_key,null::bigint as product_id,ar.product_name,ar.sku as master_sku,
    ar.category_name,ar.edition_year,ar.image_url,1::integer as platform_count,'UNLINKED'::text as presence_type,
    jsonb_build_array(jsonb_build_object(
      'source_code',ar.code,'label',ar.label,'item_count',1,
      'items',jsonb_build_array(jsonb_build_object(
        'source_row_id',ar.source_row_id,'source_code',ar.code,'label',ar.label,'sku',ar.sku,
        'product_name',ar.product_name,'category_name',ar.category_name,'edition_year',ar.edition_year,
        'update_status',ar.update_status,'video_status',ar.video_status,'listing_status',ar.listing_status,
        'relation_status',ar.relation_status,'listing_url',ar.listing_url,'image_url',ar.image_url,
        'image_source',ar.image_source,'image_source_marketplace_name',ar.image_source_marketplace_name,
        'image_source_sku',ar.image_source_sku
      ))
    )) as platforms,
    case when coalesce(uc.candidate_count,0)=1 then 'SAFE_CANDIDATE'
         when coalesce(uc.candidate_count,0)>1 then 'AMBIGUOUS'
         else 'NO_CANDIDATE' end as link_review_status,
    case when coalesce(uc.candidate_count,0)=1 then uc.suggested_product_id else null end as suggested_product_id,
    coalesce(uc.candidate_count,0)::integer as candidate_count,
    concat_ws(' ',ar.product_name,ar.sku) as search_text
  from all_rows ar
  left join unlinked_candidates uc on uc.source_row_id=ar.source_row_id
  where ar.product_id is null
),
cards as (
  select * from linked_cards
  union all
  select * from unlinked_cards
),
filtered as (
  select c.*
  from cards c
  where
    (upper(btrim(coalesce(p_presence,'LINKED'))) in ('','ALL')
     or (upper(btrim(coalesce(p_presence,'LINKED')))='LINKED' and c.presence_type in ('MULTI','EXCLUSIVE'))
     or c.presence_type=upper(btrim(coalesce(p_presence,'LINKED'))))
    and (nullif(btrim(coalesce(p_search,'')),'') is null or c.search_text ilike '%'||btrim(p_search)||'%')
    and (nullif(btrim(coalesce(p_category,'')),'') is null or upper(coalesce(c.category_name,''))=upper(btrim(p_category)))
    and (p_year is null or c.edition_year=p_year)
)
select
  f.card_key,f.product_id,f.product_name,f.master_sku,f.category_name,f.edition_year,
  f.image_url,f.platform_count,f.presence_type,f.platforms,f.link_review_status,
  f.suggested_product_id,f.candidate_count,count(*) over()
from filtered f
order by
  case f.presence_type when 'MULTI' then 0 when 'EXCLUSIVE' then 1 else 2 end,
  case f.link_review_status when 'SAFE_CANDIDATE' then 0 when 'AMBIGUOUS' then 1 else 2 end,
  lower(coalesce(f.product_name,'')),f.card_key
limit least(greatest(coalesce(p_limit,24),1),100)
offset greatest(coalesce(p_offset,0),0);
$function$;
revoke execute on function public.commerce_preview_management_products_v2(text,text,integer,text,integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_products_v2(text,text,integer,text,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_rows_v2(p_source_code text DEFAULT 'AMAZON'::text, p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_update_status text DEFAULT NULL::text, p_video_status text DEFAULT NULL::text, p_listing_status text DEFAULT NULL::text, p_image_status text DEFAULT NULL::text, p_relation_status text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(source_row_id bigint, source_code text, source_name text, source_file_id bigint, source_filename text, source_row_number integer, product_id bigint, listing_id bigint, sku text, product_name text, category_name text, edition_year integer, update_status text, video_status text, listing_status text, relation_status text, listing_url text, image_url text, image_source text, image_source_marketplace_code text, image_source_marketplace_name text, image_source_sku text, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with base as (
  select *
  from public.commerce_preview_management_rows_v1(
    p_source_code,p_search,p_category,p_update_status,p_video_status,
    p_listing_status,p_image_status,p_relation_status,p_year,p_limit,p_offset
  )
),
gs_file as (
  select id
  from public.commerce_preview_source_files
  where source_code='GS_REFERENCIA'
  order by imported_at desc nulls last,id desc
  limit 1
)
select
  b.source_row_id,
  b.source_code,
  b.source_name,
  b.source_file_id,
  b.source_filename,
  b.source_row_number,
  b.product_id,
  b.listing_id,
  b.sku,
  b.product_name,
  b.category_name,
  b.edition_year,
  b.update_status,
  b.video_status,
  b.listing_status,
  b.relation_status,
  b.listing_url,
  coalesce(b.image_url,gs.image_url) as image_url,
  case
    when b.image_url is not null then b.image_source
    when gs.image_url is not null then 'GS_REFERENCE'
    else null
  end as image_source,
  case
    when b.image_url is not null then b.image_source_marketplace_code
    when gs.image_url is not null then 'GS'
    else null
  end as image_source_marketplace_code,
  case
    when b.image_url is not null then b.image_source_marketplace_name
    when gs.image_url is not null then 'GS'
    else null
  end as image_source_marketplace_name,
  case
    when b.image_url is not null then b.image_source_sku
    when gs.image_url is not null then gs.gs_sku
    else null
  end as image_source_sku,
  b.total_count
from base b
left join lateral (
  select
    nullif(g.normalized_payload->>'image_url','') as image_url,
    nullif(g.normalized_payload->>'sku','') as gs_sku
  from gs_file f
  join public.commerce_preview_source_rows g
    on g.source_file_id=f.id and g.is_header=false
  where b.image_url is null
    and nullif(g.normalized_payload->>'image_url','') is not null
    and exists (
      select 1
      from jsonb_array_elements_text(coalesce(g.normalized_payload->'sku_norms','[]'::jsonb)) x(code)
      where x.code=regexp_replace(upper(coalesce(b.sku,'')),'[^A-Z0-9]+','','g')
    )
    and public.commerce_image_years_compatible(
      b.sku,
      g.normalized_payload->>'sku',
      g.normalized_payload->>'product_name'
    )
  order by
    case when g.normalized_payload->>'status'='Ativo' then 0 else 1 end,
    case
      when regexp_replace(upper(coalesce(g.normalized_payload->>'sku','')),'[^A-Z0-9]+','','g')
         = regexp_replace(upper(coalesce(b.sku,'')),'[^A-Z0-9]+','','g')
      then 0 else 1
    end,
    g.row_number
  limit 1
) gs on true;
$function$;
revoke execute on function public.commerce_preview_management_rows_v2(text,text,text,text,text,text,text,text,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_rows_v2(text,text,text,text,text,text,text,text,integer,integer,integer) to service_role;

