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
all_rows_raw as (
  select * from first_pages
  union all
  select * from rest_pages
),
gs_file as (
  select id
  from public.commerce_preview_source_files
  where source_code='GS_REFERENCIA'
  order by imported_at desc nulls last,id desc
  limit 1
),
gs_map as (
  select distinct on (x.code)
    x.code as sku_norm,
    nullif(g.normalized_payload->>'image_url','') as image_url,
    nullif(g.normalized_payload->>'sku','') as gs_sku,
    nullif(g.normalized_payload->>'product_name','') as gs_name
  from gs_file f
  join public.commerce_preview_source_rows g
    on g.source_file_id=f.id and g.is_header=false
  cross join lateral jsonb_array_elements_text(
    coalesce(g.normalized_payload->'sku_norms','[]'::jsonb)
  ) x(code)
  where nullif(g.normalized_payload->>'image_url','') is not null
  order by
    x.code,
    case when g.normalized_payload->>'status'='Ativo' then 0 else 1 end,
    g.row_number
),
all_rows as (
  select
    ar.code,
    ar.label,
    ar.sort_order,
    ar.source_row_id,
    ar.source_code,
    ar.source_name,
    ar.source_file_id,
    ar.source_filename,
    ar.source_row_number,
    ar.product_id,
    ar.listing_id,
    ar.sku,
    ar.product_name,
    ar.category_name,
    ar.edition_year,
    ar.update_status,
    ar.video_status,
    ar.listing_status,
    ar.relation_status,
    ar.listing_url,
    case
      when (
        ar.image_url is not null
        and (
          nullif(ar.image_source_sku,'') is null
          or public.commerce_image_years_compatible(ar.sku,ar.image_source_sku,null)
        )
      ) then ar.image_url
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then gm.image_url
      else null
    end as image_url,
    case
      when (
        ar.image_url is not null
        and (
          nullif(ar.image_source_sku,'') is null
          or public.commerce_image_years_compatible(ar.sku,ar.image_source_sku,null)
        )
      ) then ar.image_source
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then 'GS_REFERENCE'
      else null
    end as image_source,
    case
      when (
        ar.image_url is not null
        and (
          nullif(ar.image_source_sku,'') is null
          or public.commerce_image_years_compatible(ar.sku,ar.image_source_sku,null)
        )
      ) then ar.image_source_marketplace_code
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then 'GS'
      else null
    end as image_source_marketplace_code,
    case
      when (
        ar.image_url is not null
        and (
          nullif(ar.image_source_sku,'') is null
          or public.commerce_image_years_compatible(ar.sku,ar.image_source_sku,null)
        )
      ) then ar.image_source_marketplace_name
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then 'GS'
      else null
    end as image_source_marketplace_name,
    case
      when (
        ar.image_url is not null
        and (
          nullif(ar.image_source_sku,'') is null
          or public.commerce_image_years_compatible(ar.sku,ar.image_source_sku,null)
        )
      ) then ar.image_source_sku
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then gm.gs_sku
      else null
    end as image_source_sku,
    case
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then gm.image_url
      else null
    end as fallback_image_url,
    (gm.sku_norm is not null) as gs_reference_available,
    public.commerce_sku_pattern_v1(ar.sku) as sku_pattern,
    ar.total_count
  from all_rows_raw ar
  left join gs_map gm
    on gm.sku_norm=regexp_replace(upper(coalesce(ar.sku,'')),'[^A-Z0-9]+','','g')
),
variation_rows as (
  select
    ar.code,
    ar.label,
    ar.sort_order,
    ar.source_row_id,
    ar.source_code,
    ar.source_name,
    ar.source_file_id,
    ar.source_filename,
    ar.source_row_number,
    lp.product_id,
    ar.listing_id,
    coalesce(nullif(lp.platform_sku,''),ps.sku) as sku,
    cp.name as product_name,
    cc.name as category_name,
    cp.edition_year,
    ar.update_status,
    ar.video_status,
    ar.listing_status,
    lp.relation_status,
    ar.listing_url,
    case
      when gm.image_url is not null
       and public.commerce_image_years_compatible(
         coalesce(nullif(lp.platform_sku,''),ps.sku),gm.gs_sku,gm.gs_name
       )
      then gm.image_url
      else null
    end as image_url,
    case
      when gm.image_url is not null
       and public.commerce_image_years_compatible(
         coalesce(nullif(lp.platform_sku,''),ps.sku),gm.gs_sku,gm.gs_name
       )
      then 'GS_REFERENCE'
      else null
    end as image_source,
    case
      when gm.image_url is not null
       and public.commerce_image_years_compatible(
         coalesce(nullif(lp.platform_sku,''),ps.sku),gm.gs_sku,gm.gs_name
       )
      then 'GS'
      else null
    end as image_source_marketplace_code,
    case
      when gm.image_url is not null
       and public.commerce_image_years_compatible(
         coalesce(nullif(lp.platform_sku,''),ps.sku),gm.gs_sku,gm.gs_name
       )
      then 'GS'
      else null
    end as image_source_marketplace_name,
    case
      when gm.image_url is not null
       and public.commerce_image_years_compatible(
         coalesce(nullif(lp.platform_sku,''),ps.sku),gm.gs_sku,gm.gs_name
       )
      then gm.gs_sku
      else null
    end as image_source_sku,
    case
      when gm.image_url is not null
       and public.commerce_image_years_compatible(
         coalesce(nullif(lp.platform_sku,''),ps.sku),gm.gs_sku,gm.gs_name
       )
      then gm.image_url
      else null
    end as fallback_image_url,
    (gm.sku_norm is not null) as gs_reference_available,
    public.commerce_sku_pattern_v1(coalesce(nullif(lp.platform_sku,''),ps.sku)) as sku_pattern,
    ar.total_count
  from all_rows ar
  join public.commerce_preview_source_rows sr
    on sr.id=ar.source_row_id
   and sr.resolution_status='VARIATION'
   and sr.matched_listing_id=ar.listing_id
  join public.commerce_preview_listing_products lp
    on lp.listing_id=ar.listing_id
   and lp.relation_status='ACTIVE'
  join public.commerce_preview_products cp
    on cp.id=lp.product_id
  left join public.commerce_preview_categories cc
    on cc.id=cp.category_id
  left join public.commerce_preview_product_skus ps
    on ps.id=lp.product_sku_id
  left join gs_map gm
    on gm.sku_norm=regexp_replace(
      upper(coalesce(nullif(lp.platform_sku,''),ps.sku,'')),
      '[^A-Z0-9]+','','g'
    )
  where ar.product_id is null
    and ar.listing_id is not null
    and not exists (
      select 1
      from all_rows direct
      where direct.product_id=lp.product_id
        and direct.code=ar.code
    )
),
resolved_rows as (
  select * from all_rows where product_id is not null
  union all
  select * from variation_rows
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
        'image_source_sku',ar.image_source_sku,'fallback_image_url',ar.fallback_image_url,'gs_reference_available',ar.gs_reference_available,'sku_pattern',ar.sku_pattern
      )
      order by ar.source_row_number,ar.source_row_id
    ) as items
  from resolved_rows ar
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
    false as gs_reference_available,
    false as sku_review_available,
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
   and (
     nullif(u.sku_pattern->>'signature','') is null
     or u.sku_pattern->>'signature'=l.sku_pattern->>'signature'
   )
  where u.product_id is null
  group by u.source_row_id
),
master_sku_patterns as (
  select
    ps.product_id,
    public.commerce_sku_pattern_v1(ps.sku)->>'signature' as signature,
    public.commerce_sku_pattern_v1(ps.sku)->>'base_signature' as base_signature
  from public.commerce_preview_product_skus ps
),
sku_strict_ids as (
  select u.source_row_id,msp.product_id,'MASTER_SKU'::text as evidence
  from all_rows u
  join master_sku_patterns msp
    on msp.signature=u.sku_pattern->>'signature'
   and nullif(u.sku_pattern->>'signature','') is not null
  where u.product_id is null
  union
  select u.source_row_id,l.product_id,'LINKED_HISTORY'::text
  from all_rows u
  join all_rows l
    on l.product_id is not null
   and l.sku_pattern->>'signature'=u.sku_pattern->>'signature'
   and nullif(u.sku_pattern->>'signature','') is not null
  where u.product_id is null
),
sku_strict_candidates as (
  select
    source_row_id,
    count(distinct product_id)::integer as candidate_count,
    min(product_id)::bigint as suggested_product_id,
    bool_or(evidence='MASTER_SKU') as has_master_sku
  from sku_strict_ids
  group by source_row_id
),
sku_base_ids as (
  select u.source_row_id,msp.product_id,'MASTER_SKU'::text as evidence
  from all_rows u
  join master_sku_patterns msp
    on msp.base_signature=u.sku_pattern->>'base_signature'
   and nullif(u.sku_pattern->>'base_signature','') is not null
  where u.product_id is null
  union
  select u.source_row_id,l.product_id,'LINKED_HISTORY'::text
  from all_rows u
  join all_rows l
    on l.product_id is not null
   and l.sku_pattern->>'base_signature'=u.sku_pattern->>'base_signature'
   and nullif(u.sku_pattern->>'base_signature','') is not null
  where u.product_id is null
),
sku_base_candidates as (
  select
    source_row_id,
    count(distinct product_id)::integer as candidate_count,
    min(product_id)::bigint as suggested_product_id
  from sku_base_ids
  group by source_row_id
),
sku_review_candidates as (
  select
    u.source_row_id,
    case
      when coalesce(sc.candidate_count,0)>0 then true
      when coalesce(sc.candidate_count,0)=0 and coalesce(bc.candidate_count,0)>0 then true
      else false
    end as sku_review_available,
    case
      when coalesce(sc.candidate_count,0)>0 then sc.candidate_count
      else coalesce(bc.candidate_count,0)
    end::integer as sku_candidate_count,
    case
      when coalesce(sc.candidate_count,0)>0 then sc.suggested_product_id
      else bc.suggested_product_id
    end::bigint as sku_suggested_product_id,
    case
      when coalesce(sc.candidate_count,0)>0 then
        case when sc.has_master_sku then 'EXACT_COVER' else 'LINKED_HISTORY' end
      when coalesce(bc.candidate_count,0)>0 then 'COVER_COLLECTION'
      else null
    end::text as sku_candidate_source
  from all_rows u
  left join sku_strict_candidates sc using(source_row_id)
  left join sku_base_candidates bc using(source_row_id)
  where u.product_id is null
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
        'image_source_sku',ar.image_source_sku,'fallback_image_url',ar.fallback_image_url,'gs_reference_available',ar.gs_reference_available,'sku_pattern',ar.sku_pattern,
        'sku_review_available',coalesce(src.sku_review_available,false),
        'sku_candidate_count',coalesce(src.sku_candidate_count,0),
        'sku_suggested_product_id',src.sku_suggested_product_id,
        'sku_candidate_source',src.sku_candidate_source
      ))
    )) as platforms,
    case when coalesce(uc.candidate_count,0)=1 then 'SAFE_CANDIDATE'
         when coalesce(uc.candidate_count,0)>1 then 'AMBIGUOUS'
         else 'NO_CANDIDATE' end as link_review_status,
    case when coalesce(uc.candidate_count,0)=1 then uc.suggested_product_id else null end as suggested_product_id,
    coalesce(uc.candidate_count,0)::integer as candidate_count,
    coalesce(ar.gs_reference_available,false) as gs_reference_available,
    coalesce(src.sku_review_available,false) as sku_review_available,
    concat_ws(' ',ar.product_name,ar.sku) as search_text
  from all_rows ar
  left join unlinked_candidates uc on uc.source_row_id=ar.source_row_id
  left join sku_review_candidates src on src.source_row_id=ar.source_row_id
  where ar.product_id is null
    and not exists (
      select 1
      from public.commerce_preview_source_rows sr
      where sr.id=ar.source_row_id
        and sr.resolution_status='VARIATION'
    )
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
     or (upper(btrim(coalesce(p_presence,'LINKED')))='GS_REVIEW' and c.presence_type='UNLINKED' and c.gs_reference_available)
     or (upper(btrim(coalesce(p_presence,'LINKED')))='SKU_REVIEW' and c.presence_type='UNLINKED' and c.sku_review_available)
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
  case when f.sku_review_available then 0 else 1 end,
  case when f.gs_reference_available then 0 else 1 end,
  case f.link_review_status when 'SAFE_CANDIDATE' then 0 when 'AMBIGUOUS' then 1 else 2 end,
  lower(coalesce(f.product_name,'')),f.card_key
limit least(greatest(coalesce(p_limit,24),1),100)
offset greatest(coalesce(p_offset,0),0);
$function$;

revoke execute on function public.commerce_preview_management_products_v2(text,text,integer,text,integer,integer)
from public, anon, authenticated;
grant execute on function public.commerce_preview_management_products_v2(text,text,integer,text,integer,integer)
to service_role;
