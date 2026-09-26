CREATE OR REPLACE FUNCTION public.commerce_management_products_v1(p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_presence text DEFAULT 'LINKED'::text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS TABLE(card_key text, product_id bigint, product_name text, master_sku text, category_name text, edition_year integer, image_url text, platform_count integer, presence_type text, platforms jsonb, total_count bigint)
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
  cross join lateral public.commerce_management_rows_v1(
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
  cross join lateral public.commerce_management_rows_v1(
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
        'source_row_id',ar.source_row_id,
        'source_code',ar.code,
        'label',ar.label,
        'sku',ar.sku,
        'product_name',ar.product_name,
        'category_name',ar.category_name,
        'edition_year',ar.edition_year,
        'update_status',ar.update_status,
        'video_status',ar.video_status,
        'listing_status',ar.listing_status,
        'relation_status',ar.relation_status,
        'listing_url',ar.listing_url,
        'image_url',ar.image_url,
        'image_source',ar.image_source,
        'image_source_marketplace_name',ar.image_source_marketplace_name,
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
    mp.product_id,
    cp.name as product_name,
    cps.sku as master_sku,
    cc.name as category_name,
    cp.edition_year,
    count(*)::integer as platform_count,
    case when count(*) >= 2 then 'MULTI' else 'EXCLUSIVE' end as presence_type,
    jsonb_agg(
      jsonb_build_object(
        'source_code',mp.source_code,
        'label',mp.platform_label,
        'item_count',mp.item_count,
        'items',mp.items
      )
      order by mp.sort_order
    ) as platforms
  from matched_platforms mp
  join public.commerce_products cp on cp.id=mp.product_id
  left join public.commerce_categories cc on cc.id=cp.category_id
  left join lateral (
    select ps.sku
    from public.commerce_product_skus ps
    where ps.product_id=cp.id
    order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end,ps.id
    limit 1
  ) cps on true
  group by mp.product_id,cp.name,cps.sku,cc.name,cp.edition_year
),
linked_cards as (
  select
    'PRODUCT:'||lb.product_id::text as card_key,
    lb.product_id,
    lb.product_name,
    lb.master_sku,
    lb.category_name,
    lb.edition_year,
    (
      select item->>'image_url'
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
      where nullif(item->>'image_url','') is not null
      order by
        case when (item->>'edition_year') ~ '^[0-9]+$' and (item->>'edition_year')::integer=lb.edition_year then 0 else 1 end,
        case p->>'source_code'
          when 'SHOPEE' then 1
          when 'ML_NOVO' then 2
          when 'ML_ANTIGO' then 3
          when 'AMAZON' then 4
          when 'SHEIN' then 5
          else 9
        end
      limit 1
    ) as image_url,
    lb.platform_count,
    lb.presence_type,
    lb.platforms,
    concat_ws(' ',lb.product_name,lb.master_sku,(
      select string_agg(item->>'sku',' ')
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
    )) as search_text
  from linked_base lb
),
unlinked_cards as (
  select
    'ROW:'||ar.source_row_id::text as card_key,
    null::bigint as product_id,
    ar.product_name,
    ar.sku as master_sku,
    ar.category_name,
    ar.edition_year,
    ar.image_url,
    1::integer as platform_count,
    'UNLINKED'::text as presence_type,
    jsonb_build_array(
      jsonb_build_object(
        'source_code',ar.code,
        'label',ar.label,
        'item_count',1,
        'items',jsonb_build_array(
          jsonb_build_object(
            'source_row_id',ar.source_row_id,
            'source_code',ar.code,
            'label',ar.label,
            'sku',ar.sku,
            'product_name',ar.product_name,
            'category_name',ar.category_name,
            'edition_year',ar.edition_year,
            'update_status',ar.update_status,
            'video_status',ar.video_status,
            'listing_status',ar.listing_status,
            'relation_status',ar.relation_status,
            'listing_url',ar.listing_url,
            'image_url',ar.image_url,
            'image_source',ar.image_source,
            'image_source_marketplace_name',ar.image_source_marketplace_name,
            'image_source_sku',ar.image_source_sku
          )
        )
      )
    ) as platforms,
    concat_ws(' ',ar.product_name,ar.sku) as search_text
  from all_rows ar
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
    (
      upper(btrim(coalesce(p_presence,'LINKED'))) in ('','ALL')
      or (upper(btrim(coalesce(p_presence,'LINKED')))='LINKED' and c.presence_type in ('MULTI','EXCLUSIVE'))
      or c.presence_type=upper(btrim(coalesce(p_presence,'LINKED')))
    )
    and (
      nullif(btrim(coalesce(p_search,'')),'') is null
      or c.search_text ilike '%'||btrim(p_search)||'%'
    )
    and (
      nullif(btrim(coalesce(p_category,'')),'') is null
      or upper(coalesce(c.category_name,''))=upper(btrim(p_category))
    )
    and (p_year is null or c.edition_year=p_year)
)
select
  f.card_key,f.product_id,f.product_name,f.master_sku,f.category_name,f.edition_year,
  f.image_url,f.platform_count,f.presence_type,f.platforms,count(*) over()
from filtered f
order by
  case f.presence_type when 'MULTI' then 0 when 'EXCLUSIVE' then 1 else 2 end,
  lower(coalesce(f.product_name,'')),
  f.card_key
limit least(greatest(coalesce(p_limit,24),1),100)
offset greatest(coalesce(p_offset,0),0);
$function$;
revoke execute on function public.commerce_management_products_v1(text,text,integer,text,integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_management_products_v1(text,text,integer,text,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_management_product_summary_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'linked_products',coalesce((select total_count from public.commerce_management_products_v1(null,null,null,'LINKED',1,0) limit 1),0),
  'multiplatform',coalesce((select total_count from public.commerce_management_products_v1(null,null,null,'MULTI',1,0) limit 1),0),
  'exclusive',coalesce((select total_count from public.commerce_management_products_v1(null,null,null,'EXCLUSIVE',1,0) limit 1),0),
  'unlinked',coalesce((select total_count from public.commerce_management_products_v1(null,null,null,'UNLINKED',1,0) limit 1),0)
);
$function$;
revoke execute on function public.commerce_management_product_summary_v1() from public, anon, authenticated;
grant execute on function public.commerce_management_product_summary_v1() to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_products_v1(p_search text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_year integer DEFAULT NULL::integer, p_presence text DEFAULT 'LINKED'::text, p_limit integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS TABLE(card_key text, product_id bigint, product_name text, master_sku text, category_name text, edition_year integer, image_url text, platform_count integer, presence_type text, platforms jsonb, total_count bigint)
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
  cross join lateral public.commerce_preview_management_rows_v1(
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
  cross join lateral public.commerce_preview_management_rows_v1(
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
        'source_row_id',ar.source_row_id,
        'source_code',ar.code,
        'label',ar.label,
        'sku',ar.sku,
        'product_name',ar.product_name,
        'category_name',ar.category_name,
        'edition_year',ar.edition_year,
        'update_status',ar.update_status,
        'video_status',ar.video_status,
        'listing_status',ar.listing_status,
        'relation_status',ar.relation_status,
        'listing_url',ar.listing_url,
        'image_url',ar.image_url,
        'image_source',ar.image_source,
        'image_source_marketplace_name',ar.image_source_marketplace_name,
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
    mp.product_id,
    cp.name as product_name,
    cps.sku as master_sku,
    cc.name as category_name,
    cp.edition_year,
    count(*)::integer as platform_count,
    case when count(*) >= 2 then 'MULTI' else 'EXCLUSIVE' end as presence_type,
    jsonb_agg(
      jsonb_build_object(
        'source_code',mp.source_code,
        'label',mp.platform_label,
        'item_count',mp.item_count,
        'items',mp.items
      )
      order by mp.sort_order
    ) as platforms
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
    'PRODUCT:'||lb.product_id::text as card_key,
    lb.product_id,
    lb.product_name,
    lb.master_sku,
    lb.category_name,
    lb.edition_year,
    (
      select item->>'image_url'
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
      where nullif(item->>'image_url','') is not null
      order by
        case when (item->>'edition_year') ~ '^[0-9]+$' and (item->>'edition_year')::integer=lb.edition_year then 0 else 1 end,
        case p->>'source_code'
          when 'SHOPEE' then 1
          when 'ML_NOVO' then 2
          when 'ML_ANTIGO' then 3
          when 'AMAZON' then 4
          when 'SHEIN' then 5
          else 9
        end
      limit 1
    ) as image_url,
    lb.platform_count,
    lb.presence_type,
    lb.platforms,
    concat_ws(' ',lb.product_name,lb.master_sku,(
      select string_agg(item->>'sku',' ')
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
    )) as search_text
  from linked_base lb
),
unlinked_cards as (
  select
    'ROW:'||ar.source_row_id::text as card_key,
    null::bigint as product_id,
    ar.product_name,
    ar.sku as master_sku,
    ar.category_name,
    ar.edition_year,
    ar.image_url,
    1::integer as platform_count,
    'UNLINKED'::text as presence_type,
    jsonb_build_array(
      jsonb_build_object(
        'source_code',ar.code,
        'label',ar.label,
        'item_count',1,
        'items',jsonb_build_array(
          jsonb_build_object(
            'source_row_id',ar.source_row_id,
            'source_code',ar.code,
            'label',ar.label,
            'sku',ar.sku,
            'product_name',ar.product_name,
            'category_name',ar.category_name,
            'edition_year',ar.edition_year,
            'update_status',ar.update_status,
            'video_status',ar.video_status,
            'listing_status',ar.listing_status,
            'relation_status',ar.relation_status,
            'listing_url',ar.listing_url,
            'image_url',ar.image_url,
            'image_source',ar.image_source,
            'image_source_marketplace_name',ar.image_source_marketplace_name,
            'image_source_sku',ar.image_source_sku
          )
        )
      )
    ) as platforms,
    concat_ws(' ',ar.product_name,ar.sku) as search_text
  from all_rows ar
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
    (
      upper(btrim(coalesce(p_presence,'LINKED'))) in ('','ALL')
      or (upper(btrim(coalesce(p_presence,'LINKED')))='LINKED' and c.presence_type in ('MULTI','EXCLUSIVE'))
      or c.presence_type=upper(btrim(coalesce(p_presence,'LINKED')))
    )
    and (
      nullif(btrim(coalesce(p_search,'')),'') is null
      or c.search_text ilike '%'||btrim(p_search)||'%'
    )
    and (
      nullif(btrim(coalesce(p_category,'')),'') is null
      or upper(coalesce(c.category_name,''))=upper(btrim(p_category))
    )
    and (p_year is null or c.edition_year=p_year)
)
select
  f.card_key,f.product_id,f.product_name,f.master_sku,f.category_name,f.edition_year,
  f.image_url,f.platform_count,f.presence_type,f.platforms,count(*) over()
from filtered f
order by
  case f.presence_type when 'MULTI' then 0 when 'EXCLUSIVE' then 1 else 2 end,
  lower(coalesce(f.product_name,'')),
  f.card_key
limit least(greatest(coalesce(p_limit,24),1),100)
offset greatest(coalesce(p_offset,0),0);
$function$;
revoke execute on function public.commerce_preview_management_products_v1(text,text,integer,text,integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_products_v1(text,text,integer,text,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_product_summary_v1()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select jsonb_build_object(
  'linked_products',coalesce((select total_count from public.commerce_preview_management_products_v1(null,null,null,'LINKED',1,0) limit 1),0),
  'multiplatform',coalesce((select total_count from public.commerce_preview_management_products_v1(null,null,null,'MULTI',1,0) limit 1),0),
  'exclusive',coalesce((select total_count from public.commerce_preview_management_products_v1(null,null,null,'EXCLUSIVE',1,0) limit 1),0),
  'unlinked',coalesce((select total_count from public.commerce_preview_management_products_v1(null,null,null,'UNLINKED',1,0) limit 1),0)
);
$function$;
revoke execute on function public.commerce_preview_management_product_summary_v1() from public, anon, authenticated;
grant execute on function public.commerce_preview_management_product_summary_v1() to service_role;

