CREATE OR REPLACE FUNCTION public.commerce_sku_pattern_v1(p_sku text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
with n as (
  select trim(both '_' from regexp_replace(upper(btrim(coalesce(p_sku,''))),'[^A-Z0-9]+','_','g')) as sku_norm
),
p as (
  select sku_norm,string_to_array(sku_norm,'_') as tokens
  from n
),
x as (
  select
    sku_norm,tokens,cardinality(tokens) as token_count,
    case
      when tokens[1] ~ '^(.*)20(2[0-9]|3[0-5])$'
        then regexp_replace(tokens[1],'20(2[0-9]|3[0-5])$','')
      when tokens[1] ~ '^(.*)(2[0-9]|3[0-5])$'
        then regexp_replace(tokens[1],'(2[0-9]|3[0-5])$','')
      else tokens[1]
    end as family_key,
    case
      when tokens[1] ~ '20(2[0-9]|3[0-5])$'
        then substring(tokens[1] from '(20(?:2[0-9]|3[0-5]))$')::integer
      when tokens[1] ~ '(2[0-9]|3[0-5])$'
        then 2000 + substring(tokens[1] from '((?:2[0-9]|3[0-5]))$')::integer
      else null
    end as edition_year,
    case
      when cardinality(tokens)>=3 and tokens[cardinality(tokens)] ~ '^[A-Z]{3}$'
        then array_to_string(tokens[2:cardinality(tokens)-1], '_')
      when cardinality(tokens)>=2
        then array_to_string(tokens[2:cardinality(tokens)], '_')
      else null
    end as cover_raw,
    case
      when cardinality(tokens)>=3 and tokens[cardinality(tokens)] ~ '^[A-Z]{3}$'
        then tokens[cardinality(tokens)]
      else null
    end as finish_key
  from p
),
z as (
  select *,
    case
      when token_count>=3 and finish_key is not null
        then regexp_replace(cover_raw,'[0-9]+$','')
      else cover_raw
    end as cover_base,
    case
      when token_count>=3 and finish_key is not null and cover_raw ~ '[0-9]+$'
        then substring(cover_raw from '([0-9]+)$')::integer
      else null
    end as cover_variant
  from x
)
select jsonb_build_object(
  'sku_norm',nullif(sku_norm,''),
  'family',nullif(family_key,''),
  'year',edition_year,
  'cover',nullif(cover_raw,''),
  'cover_base',nullif(cover_base,''),
  'cover_variant',cover_variant,
  'finish',finish_key,
  'signature',
    case when nullif(family_key,'') is not null and nullif(cover_raw,'') is not null
      then family_key||'|'||cover_raw
      else null end,
  'base_signature',
    case when nullif(family_key,'') is not null and nullif(cover_base,'') is not null
      then family_key||'|'||cover_base
      else null end
)
from z;
$function$;
revoke execute on function public.commerce_sku_pattern_v1(text) from public, anon, authenticated;
grant execute on function public.commerce_sku_pattern_v1(text) to service_role;


-- Preview-only: link only when family + exact cover identify one Product Master.
-- Year and finishing code may differ. Cover variation remains exact (JPH1 != JPH2).
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
unlinked as (
  select
    r.id source_row_id,
    public.commerce_sku_pattern_v1(
      coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))
    )->>'signature' signature
  from selected_files f
  join public.commerce_preview_source_rows r
    on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
candidates as (
  select
    u.source_row_id,
    min(ps.product_id) product_id,
    count(distinct ps.product_id)::integer candidate_count
  from unlinked u
  join public.commerce_preview_product_skus ps
    on public.commerce_sku_pattern_v1(ps.sku)->>'signature'=u.signature
   and nullif(u.signature,'') is not null
  group by u.source_row_id
),
safe as (
  select source_row_id,product_id
  from candidates
  where candidate_count=1
)
update public.commerce_preview_source_rows r
set matched_product_id=s.product_id,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview SKU exact-cover link: same family + exact cover, year/finish ignored')
from safe s
where r.id=s.source_row_id
  and r.matched_product_id is null;

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
    coalesce(
      ar.image_url,
      case
        when gm.image_url is not null
         and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
        then gm.image_url
      end
    ) as image_url,
    case
      when ar.image_url is not null then ar.image_source
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then 'GS_REFERENCE'
      else null
    end as image_source,
    case
      when ar.image_url is not null then ar.image_source_marketplace_code
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then 'GS'
      else null
    end as image_source_marketplace_code,
    case
      when ar.image_url is not null then ar.image_source_marketplace_name
      when gm.image_url is not null
       and public.commerce_image_years_compatible(ar.sku,gm.gs_sku,gm.gs_name)
      then 'GS'
      else null
    end as image_source_marketplace_name,
    case
      when ar.image_url is not null then ar.image_source_sku
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
revoke execute on function public.commerce_preview_management_products_v2(text,text,integer,text,integer,integer) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_products_v2(text,text,integer,text,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_product_summary_v2()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with base as (
  select coalesce(public.commerce_preview_management_product_summary_v1(),'{}'::jsonb) as data
),
selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id,replace(source_code,'_GESTAO','') as platform
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
unlinked as (
  select r.id,
         regexp_replace(upper(coalesce(
           nullif(r.normalized_payload->>'sku',''),
           nullif(r.normalized_payload->>'sku_base',''),
           nullif(r.normalized_payload->>'sku_primary',''),
           ''
         )),'[^A-Z0-9]+','','g') as sku_norm
  from selected_files f
  join public.commerce_preview_source_rows r
    on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
gs_file as (
  select id
  from public.commerce_preview_source_files
  where source_code='GS_REFERENCIA'
  order by imported_at desc nulls last,id desc
  limit 1
),
gs_codes as (
  select distinct x.code
  from gs_file f
  join public.commerce_preview_source_rows g on g.source_file_id=f.id and g.is_header=false
  cross join lateral jsonb_array_elements_text(coalesce(g.normalized_payload->'sku_norms','[]'::jsonb)) x(code)
)
select b.data || jsonb_build_object(
  'gs_reference_matches',
  (select count(*) from unlinked u join gs_codes g on g.code=u.sku_norm),
  'sku_review_matches',
  coalesce((
    select max(total_count)
    from public.commerce_preview_management_products_v2(null,null,null,'SKU_REVIEW',1,0)
  ),0)
)
from base b;
$function$;
revoke execute on function public.commerce_preview_management_product_summary_v2() from public, anon, authenticated;
grant execute on function public.commerce_preview_management_product_summary_v2() to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_link_candidates_v2(p_source_row_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with base as (
  select coalesce(public.commerce_preview_management_link_candidates_v1(p_source_row_id),'{}'::jsonb) as data
),
source_pattern as (
  select public.commerce_sku_pattern_v1(b.data->'source'->>'sku') as pattern
  from base b
),
gs_file as (
  select id
  from public.commerce_preview_source_files
  where source_code='GS_REFERENCIA'
  order by imported_at desc nulls last,id desc
  limit 1
),
gs_match as (
  select g.normalized_payload as payload
  from base b
  join gs_file f on true
  join public.commerce_preview_source_rows g on g.source_file_id=f.id and g.is_header=false
  where exists (
    select 1
    from jsonb_array_elements_text(coalesce(g.normalized_payload->'sku_norms','[]'::jsonb)) x(code)
    where x.code=regexp_replace(upper(coalesce(b.data->'source'->>'sku','')),'[^A-Z0-9]+','','g')
  )
  order by
    case when g.normalized_payload->>'status'='Ativo' then 0 else 1 end,
    g.row_number
  limit 1
),
selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id,
    replace(source_code,'_GESTAO','') as source_code
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''), imported_at desc nulls last, id desc
),
direct_ids as (
  select distinct ps.product_id,1 as reason_priority
  from source_pattern sp
  join public.commerce_preview_product_skus ps
    on public.commerce_sku_pattern_v1(ps.sku)->>'signature'=sp.pattern->>'signature'
   and nullif(sp.pattern->>'signature','') is not null
),
history_ids as (
  select distinct r.matched_product_id as product_id,2 as reason_priority
  from source_pattern sp
  join selected_files sf on true
  join public.commerce_preview_source_rows r
    on r.source_file_id=sf.id
   and r.is_header=false
   and r.matched_product_id is not null
  where public.commerce_sku_pattern_v1(
    coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))
  )->>'signature'=sp.pattern->>'signature'
    and nullif(sp.pattern->>'signature','') is not null
),
base_master_ids as (
  select distinct ps.product_id,3 as reason_priority
  from source_pattern sp
  join public.commerce_preview_product_skus ps
    on public.commerce_sku_pattern_v1(ps.sku)->>'base_signature'=sp.pattern->>'base_signature'
   and nullif(sp.pattern->>'base_signature','') is not null
),
base_history_ids as (
  select distinct r.matched_product_id as product_id,4 as reason_priority
  from source_pattern sp
  join selected_files sf on true
  join public.commerce_preview_source_rows r
    on r.source_file_id=sf.id
   and r.is_header=false
   and r.matched_product_id is not null
  where public.commerce_sku_pattern_v1(
    coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))
  )->>'base_signature'=sp.pattern->>'base_signature'
    and nullif(sp.pattern->>'base_signature','') is not null
),
candidate_ids as (
  select product_id,min(reason_priority) reason_priority
  from (
    select * from direct_ids
    union all
    select * from history_ids
    union all
    select * from base_master_ids
    union all
    select * from base_history_ids
  ) x
  where product_id is not null
  group by product_id
),
candidate_details as (
  select
    p.id as product_id,
    p.name as product_name,
    c.name as category_name,
    p.edition_year,
    ms.master_sku,
    ms.master_skus,
    ci.reason_priority,
    case ci.reason_priority
      when 1 then 'MASTER_SKU'
      when 2 then 'LINKED_HISTORY'
      when 3 then 'COVER_COLLECTION'
      else 'COVER_COLLECTION_HISTORY'
    end as match_reason,
    media.image_url,
    coalesce(pl.platforms,'[]'::jsonb) as platforms,
    coalesce(pl.platform_count,0) as platform_count
  from candidate_ids ci
  join public.commerce_preview_products p on p.id=ci.product_id
  left join public.commerce_preview_categories c on c.id=p.category_id
  left join lateral (
    select
      (array_agg(ps.sku order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end,ps.id))[1] as master_sku,
      jsonb_agg(ps.sku order by case when ps.sku_type='CURRENT' and ps.is_active then 0 when ps.is_active then 1 else 2 end,ps.id) as master_skus
    from public.commerce_preview_product_skus ps
    where ps.product_id=p.id
  ) ms on true
  left join lateral (
    select '/api/images/'||pml.source_product_id::text as image_url
    from public.commerce_preview_product_media_links pml
    where pml.product_id=p.id
      and pml.source_product_id is not null
    order by pml.id
    limit 1
  ) media on true
  left join lateral (
    select
      count(distinct sf.source_code)::integer as platform_count,
      jsonb_agg(distinct jsonb_build_object(
        'source_code',sf.source_code,
        'label',case sf.source_code
          when 'SHOPEE' then 'Shopee'
          when 'ML_NOVO' then 'ML Novo'
          when 'ML_ANTIGO' then 'ML Antigo'
          when 'AMAZON' then 'Amazon'
          when 'SHEIN' then 'Shein'
          else sf.source_code
        end
      )) as platforms
    from selected_files sf
    join public.commerce_preview_source_rows r
      on r.source_file_id=sf.id
     and r.is_header=false
     and r.matched_product_id=p.id
  ) pl on true
)
select
  b.data || jsonb_build_object(
    'gs_reference',
    (
      select jsonb_build_object(
        'gtin',m.payload->>'gtin',
        'sku',m.payload->>'sku',
        'sku_all',coalesce(m.payload->'sku_all','[]'::jsonb),
        'sku_format',m.payload->>'sku_format',
        'product_name',m.payload->>'product_name',
        'status',m.payload->>'status',
        'brand',m.payload->>'brand',
        'image_url',m.payload->>'image_url',
        'image_count',coalesce((m.payload->>'image_count')::integer,0),
        'ncm',m.payload->>'ncm',
        'cest',m.payload->>'cest',
        'gs_row_number',coalesce((m.payload->>'gs_row_number')::integer,0)
      )
      from gs_match m
    ),
    'sku_pattern',(select pattern from source_pattern),
    'sku_candidates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',d.product_id,
        'product_name',d.product_name,
        'master_sku',d.master_sku,
        'master_skus',coalesce(d.master_skus,'[]'::jsonb),
        'category_name',d.category_name,
        'edition_year',d.edition_year,
        'image_url',d.image_url,
        'platform_count',d.platform_count,
        'platforms',d.platforms,
        'match_reason',d.match_reason
      ) order by d.reason_priority,d.product_name,d.product_id)
      from candidate_details d
    ),'[]'::jsonb)
  )
from base b;
$function$;
revoke execute on function public.commerce_preview_management_link_candidates_v2(bigint) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_link_candidates_v2(bigint) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_resolve_link_v1(p_source_row_id bigint, p_product_id bigint, p_operator text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_valid boolean := false;
  v_updated bigint := 0;
begin
  with sources(code) as (
    values ('SHOPEE'),('ML_NOVO'),('ML_ANTIGO'),('AMAZON'),('SHEIN')
  ),
  selected_files as (
    select s.code,(
      select f.id
      from public.commerce_preview_source_files f
      where upper(f.source_code) in (s.code,s.code||'_GESTAO')
      order by case when upper(f.source_code)=s.code||'_GESTAO' then 0 else 1 end,
               f.imported_at desc nulls last,f.id desc
      limit 1
    ) source_file_id
    from sources s
  ),
  rows as (
    select
      sf.code,
      r.id as source_row_id,
      r.matched_product_id,
      lower(regexp_replace(btrim(coalesce(r.normalized_payload->>'product_name','')),'[^[:alnum:]]+','','g')) name_norm,
      upper(btrim(coalesce(r.normalized_payload->>'category',''))) category_norm,
      coalesce(
        substring(coalesce(r.normalized_payload->>'sku','') from '(20[0-9]{2})')::integer,
        substring(coalesce(r.normalized_payload->>'product_name','') from '(20[0-9]{2})')::integer
      ) edition_year,
      public.commerce_sku_pattern_v1(
        coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))
      ) sku_pattern
    from selected_files sf
    join public.commerce_preview_source_rows r
      on r.source_file_id=sf.source_file_id and r.is_header=false
  ),
  target as (
    select *
    from rows
    where source_row_id=p_source_row_id and matched_product_id is null
  )
  select exists(
    select 1
    from target u
    where
      exists (
        select 1
        from rows l
        where l.matched_product_id=p_product_id
          and l.name_norm=u.name_norm and u.name_norm<>''
          and l.category_norm=u.category_norm
          and coalesce(l.edition_year,-1)=coalesce(u.edition_year,-1)
      )
      or exists (
        select 1
        from public.commerce_preview_product_skus ps
        where ps.product_id=p_product_id
          and (
            public.commerce_sku_pattern_v1(ps.sku)->>'signature'=u.sku_pattern->>'signature'
            or public.commerce_sku_pattern_v1(ps.sku)->>'base_signature'=u.sku_pattern->>'base_signature'
          )
          and nullif(u.sku_pattern->>'base_signature','') is not null
      )
      or exists (
        select 1
        from rows l
        where l.matched_product_id=p_product_id
          and nullif(u.sku_pattern->>'base_signature','') is not null
          and (
            l.sku_pattern->>'signature'=u.sku_pattern->>'signature'
            or l.sku_pattern->>'base_signature'=u.sku_pattern->>'base_signature'
          )
      )
  ) into v_valid;

  if not v_valid then
    raise exception 'Produto candidato inválido para esta linha.';
  end if;

  update public.commerce_preview_source_rows
  set matched_product_id=p_product_id,
      resolution_status='PRODUCT_MATCHED',
      notes=concat_ws(
        ' · ',
        nullif(notes,''),
        'preview manual link by '||coalesce(nullif(btrim(p_operator),''),'Administrador')
      )
  where id=p_source_row_id and matched_product_id is null
  returning id into v_updated;

  if v_updated is null then
    raise exception 'Linha já vinculada ou não encontrada.';
  end if;

  return jsonb_build_object(
    'ok',true,
    'source_row_id',p_source_row_id,
    'product_id',p_product_id
  );
end;
$function$;
revoke execute on function public.commerce_preview_management_resolve_link_v1(bigint,bigint,text) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_resolve_link_v1(bigint,bigint,text) to service_role;

