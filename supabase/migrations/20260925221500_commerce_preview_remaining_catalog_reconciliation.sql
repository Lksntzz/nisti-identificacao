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
      when cardinality(tokens)>=3 and tokens[cardinality(tokens)] ~ '^[A-Z]{2,3}$'
        then array_to_string(tokens[2:cardinality(tokens)-1], '_')
      when cardinality(tokens)>=2
        then array_to_string(tokens[2:cardinality(tokens)], '_')
      else null
    end as cover_raw,
    case
      when cardinality(tokens)>=3 and tokens[cardinality(tokens)] ~ '^[A-Z]{2,3}$'
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



-- Preview-only reconciliation of the remaining high-confidence catalog rows.
-- Never runs against live commerce tables.

-- GTIN used as marketplace SKU: resolve through GS/NISTI-backed master.
update public.commerce_preview_source_rows r
set matched_product_id=pml.product_id,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview GTIN -> GS SKU -> Product Master match: 7898764982617 -> VACMNO_LIN1_BBB')
from public.commerce_preview_product_media_links pml
where r.id=4906
  and r.matched_product_id is null
  and pml.source_kind='NISTI_ID'
  and regexp_replace(upper(coalesce(pml.matched_sku,'')),'[^A-Z0-9]+','','g')='VACMNOLIN1BBB';

-- Legacy 2-letter finish codes: exact family+cover already confirmed in Shopee.
update public.commerce_preview_source_rows
set matched_product_id=110,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(notes,''),'preview legacy SKU match: exact family+cover from linked Shopee history; 2-letter finish supported')
where id in (3957,3958,3959,4154,4319,4320)
  and matched_product_id is null;

-- Same exact SKU in multiple platforms => one new Product Master.
create temporary table _exact_sku_groups on commit drop as
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id,replace(source_code,'_GESTAO','') platform
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
u as (
  select f.platform,r.id source_row_id,
         coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base','')) sku,
         regexp_replace(upper(coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''),'')),'[^A-Z0-9]+','','g') sku_norm,
         r.normalized_payload->>'product_name' product_name,
         coalesce(nullif(r.normalized_payload->>'category',''),'Outros') category_name
  from selected_files f
  join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
groups as (
  select sku_norm,min(sku) display_sku,count(*) row_count,count(distinct platform) platform_count,
         array_agg(source_row_id order by source_row_id) source_row_ids
  from u where sku_norm<>''
  group by sku_norm
  having count(distinct platform)>=2
),
picked as (
  select distinct on (u.sku_norm) u.sku_norm,u.product_name
  from u join groups g using(sku_norm)
  order by u.sku_norm,length(coalesce(u.product_name,'')) desc,u.source_row_id
)
select row_number() over(order by g.sku_norm)::int seq,g.*,
       p.product_name,
       case
         when lower(p.product_name) like '%caderneta%' then 'Caderneta de Vacinação'
         when lower(p.product_name) like '%caderno%' then 'Caderno'
         when lower(p.product_name) like '%planner%' then 'Planner'
         when lower(p.product_name) like '%agenda%' then 'Agenda'
         else 'Outros'
       end inferred_category,
       nullif(public.commerce_sku_pattern_v1(g.display_sku)->>'year','')::int edition_year
from groups g join picked p using(sku_norm)
where not exists (
  select 1 from public.commerce_preview_product_skus ps
  where regexp_replace(upper(ps.sku),'[^A-Z0-9]+','','g')=g.sku_norm
);

do $$
declare vg int; vr int;
begin
  select count(*),coalesce(sum(row_count),0) into vg,vr from _exact_sku_groups;
  if vg<>8 or vr<>19 then
    raise exception 'Exact-SKU reconciliation changed: groups=%, rows=% (expected 8/19)',vg,vr;
  end if;
end $$;

create temporary table _exact_sku_created on commit drop as
with b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select g.*,b.max_id+g.seq::bigint product_id,c.id category_id
from _exact_sku_groups g cross join b
left join public.commerce_preview_categories c
  on lower(btrim(c.name))=lower(btrim(g.inferred_category));

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
)
select product_id,product_name,coalesce(category_id,5),null,
       case when edition_year is not null then 'ANNUAL' else 'UNCLASSIFIED' end,
       edition_year,'DRAFT',
       concat('Criado no preview por SKU exato repetido em ',platform_count,' plataformas. SKU=',display_sku),
       now(),now()
from _exact_sku_created;

with b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+row_number() over(order by product_id),product_id,display_sku,'CURRENT',
       edition_year,null,true,now(),now()
from _exact_sku_created cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview cross-platform exact SKU reconciliation')
from _exact_sku_created c
where r.id=any(c.source_row_ids) and r.matched_product_id is null;

-- Same family + exact cover across years/platforms; newest SKU becomes CURRENT.
create temporary table _cross_year_groups on commit drop as
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id,replace(source_code,'_GESTAO','') platform
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
u as (
  select f.platform,r.id source_row_id,
         coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base','')) sku,
         r.normalized_payload->>'product_name' product_name,
         coalesce(nullif(r.normalized_payload->>'category',''),'Outros') category_name,
         public.commerce_sku_pattern_v1(coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))) pattern
  from selected_files f
  join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
groups as (
  select pattern->>'signature' signature,count(*) row_count,count(distinct platform) platform_count,
         array_agg(source_row_id order by source_row_id) source_row_ids
  from u
  where nullif(pattern->>'signature','') is not null
    and pattern->>'signature'<>'PLAN|MPO'
  group by pattern->>'signature'
  having count(distinct platform)>=2
),
current_rows as (
  select distinct on (g.signature)
    g.signature,u.sku current_sku,u.product_name current_name,u.category_name,
    nullif(u.pattern->>'year','')::int edition_year,u.pattern->>'cover' cover_key
  from groups g join u on u.pattern->>'signature'=g.signature
  order by g.signature,nullif(u.pattern->>'year','')::int desc nulls last,
           case u.platform when 'SHOPEE' then 0 when 'ML_NOVO' then 1 when 'ML_ANTIGO' then 2 when 'AMAZON' then 3 else 4 end,
           u.source_row_id
)
select row_number() over(order by g.signature)::int seq,g.*,cr.current_sku,cr.current_name,
       cr.category_name,cr.edition_year,cr.cover_key
from groups g join current_rows cr using(signature);

do $$
declare vg int; vr int;
begin
  select count(*),coalesce(sum(row_count),0) into vg,vr from _cross_year_groups;
  if vg<>7 or vr<>15 then
    raise exception 'Cross-year reconciliation changed: groups=%, rows=% (expected 7/15)',vg,vr;
  end if;
end $$;

create temporary table _cross_year_created on commit drop as
with b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select g.*,b.max_id+g.seq::bigint product_id,c.id category_id
from _cross_year_groups g cross join b
left join public.commerce_preview_categories c
  on lower(btrim(c.name))=lower(btrim(g.category_name));

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
)
select product_id,concat(current_name,' - Capa ',cover_key),coalesce(category_id,5),null,
       'ANNUAL',edition_year,'DRAFT',
       concat('Criado no preview por mesma família+capa em múltiplos anos/plataformas. Assinatura=',signature),
       now(),now()
from _cross_year_created;

with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
rows as (
  select r.id source_row_id,
         coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base','')) sku,
         public.commerce_sku_pattern_v1(coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))) pattern
  from selected_files f join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
),
all_skus as (
  select c.product_id,c.current_sku,r.sku,nullif(r.pattern->>'year','')::int sku_year
  from _cross_year_created c join rows r on r.pattern->>'signature'=c.signature
  where r.source_row_id=any(c.source_row_ids)
),
dedup as (
  select distinct on (product_id,regexp_replace(upper(sku),'[^A-Z0-9]+','','g'))
    product_id,current_sku,sku,sku_year
  from all_skus
  order by product_id,regexp_replace(upper(sku),'[^A-Z0-9]+','','g'),sku_year desc nulls last
),
n as (
  select row_number() over(order by product_id,sku_year desc nulls last,sku)::bigint rn,* from dedup
),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+n.rn,n.product_id,n.sku,
       case when regexp_replace(upper(n.sku),'[^A-Z0-9]+','','g')=regexp_replace(upper(n.current_sku),'[^A-Z0-9]+','','g')
            then 'CURRENT' else 'HISTORICAL' end,
       n.sku_year,
       case when regexp_replace(upper(n.sku),'[^A-Z0-9]+','','g')=regexp_replace(upper(n.current_sku),'[^A-Z0-9]+','','g')
            then null else n.sku_year end,
       regexp_replace(upper(n.sku),'[^A-Z0-9]+','','g')=regexp_replace(upper(n.current_sku),'[^A-Z0-9]+','','g'),
       now(),now()
from n cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview cross-year exact-cover reconciliation')
from _cross_year_created c
where r.id=any(c.source_row_ids) and r.matched_product_id is null;

-- Compact legacy codes with a confirmed NISTI ID target.
update public.commerce_preview_source_rows r
set matched_product_id=pml.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),
      case r.id
        when 3683 then 'preview compact legacy SKU -> NISTI ID: CADCONTFIN01 -> CONFIN_MHC1_BBB (capa 1)'
        when 3666 then 'preview compact legacy SKU -> NISTI ID: VACMNOSF -> VACMNO_SFR_BVV (Safari)'
      end)
from public.commerce_preview_product_media_links pml
where r.id in (3683,3666)
  and r.matched_product_id is null
  and pml.source_kind='NISTI_ID'
  and (
    (r.id=3683 and pml.source_product_id=82)
    or (r.id=3666 and pml.source_product_id=150)
  );

-- Exact-name cross-platform combo with two historical SKU spellings.
do $$
declare vp bigint; vb bigint;
begin
  if (select count(*) from public.commerce_preview_source_rows where id in (4009,4311) and matched_product_id is null)=2 then
    select coalesce(max(id),0)+1 into vp from public.commerce_preview_products;
    insert into public.commerce_preview_products(
      id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
    ) values (
      vp,'Combo 10 Agendas Personalizadas - Sua Logomarca / Foto',1,null,'ANNUAL',2026,'DRAFT',
      'Criado no preview por nome exato em múltiplas plataformas; categoria corrigida para Agenda.',now(),now()
    );
    select coalesce(max(id),0) into vb from public.commerce_preview_product_skus;
    insert into public.commerce_preview_product_skus(
      id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
    ) values
      (vb+1,vp,'PB26_CMB10','CURRENT',2026,null,true,now(),now()),
      (vb+2,vp,'PB26 CMB10AGP','ALIAS',2026,null,true,now(),now());
    update public.commerce_preview_source_rows
    set matched_product_id=vp,resolution_status='PRODUCT_MATCHED',
        notes=concat_ws(' · ',nullif(notes,''),'preview exact-name cross-platform reconciliation: Combo 10 agendas')
    where id in (4009,4311);
  end if;
end $$;

-- Agenda escolar meninos: Amazon CAPA 02..05 maps explicitly to Shopee CP2..CP5.
create temporary table _school_boys(
  seq int primary key,cover_num int,amazon_row bigint,shopee_row bigint,current_sku text,alias_sku text
) on commit drop;
insert into _school_boys values
  (1,2,3643,4945,'CADMNO CP2 BB','AGESCINMO_02'),
  (2,3,3644,4946,'CADMNO CP3 BB','AGESCINMO_03'),
  (3,4,3645,4947,'CADMNO CP4 BB','AGESCINMO_04'),
  (4,5,3646,4948,'CADMNO CP5 BB','AGESCINMO_05');

create temporary table _school_boys_created on commit drop as
with missing as (
  select s.*,row_number() over(order by seq)::bigint rn
  from _school_boys s
  where (select count(*) from public.commerce_preview_source_rows r
         where r.id in (s.amazon_row,s.shopee_row) and r.matched_product_id is null)=2
),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select m.*,b.max_id+m.rn product_id from missing m cross join b;

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
)
select product_id,'Agenda Escolar Infantil Permanente - Meninos - CAPA '||cover_num,
       1,null,'UNCLASSIFIED',null,'DRAFT',
       'Criado no preview por equivalência explícita de capa: Amazon CAPA 0'||cover_num||' ↔ Shopee CP'||cover_num,
       now(),now()
from _school_boys_created;

with x as (
  select product_id,current_sku sku,'CURRENT'::text sku_type,1 ord from _school_boys_created
  union all
  select product_id,alias_sku,'ALIAS',2 from _school_boys_created
),
n as (select row_number() over(order by product_id,ord)::bigint rn,* from x),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+n.rn,n.product_id,n.sku,n.sku_type,null,null,true,now(),now()
from n cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=s.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview agenda escolar meninos: capa numérica alinhada Amazon/Shopee')
from _school_boys_created s
where r.id in (s.amazon_row,s.shopee_row) and r.matched_product_id is null;

-- Remaining isolated rows become DRAFT exclusive masters, except the 12 manual-review cases.
create temporary table _provisional_exclusive on commit drop as
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id,replace(source_code,'_GESTAO','') platform
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
u as (
  select f.platform,r.id source_row_id,
         coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base','')) sku,
         r.normalized_payload->>'product_name' product_name,
         coalesce(nullif(r.normalized_payload->>'category',''),'Outros') source_category,
         public.commerce_sku_pattern_v1(coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))) sku_pattern
  from selected_files f
  join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
excluded as (
  select unnest(array[
    3638,3639,3640,3641,4934,4935,4936,4937,
    3811,4959,3658,4908
  ]::bigint[]) source_row_id
)
select row_number() over(order by u.source_row_id)::int seq,u.*,
       case
         when lower(coalesce(u.product_name,'')) like '%caderneta%' then 'Caderneta de Vacinação'
         when lower(coalesce(u.product_name,'')) like '%caderno%' then 'Caderno'
         when lower(coalesce(u.product_name,'')) like '%planner%' then 'Planner'
         when lower(coalesce(u.product_name,'')) like '%agenda%' then 'Agenda'
         else u.source_category
       end inferred_category,
       coalesce(
         nullif(u.sku_pattern->>'year','')::int,
         nullif(substring(coalesce(u.product_name,'') from '(20[0-9]{2})'),'')::int
       ) edition_year
from u left join excluded e using(source_row_id)
where e.source_row_id is null;

do $$
declare vc int;
begin
  select count(*) into vc from _provisional_exclusive;
  if vc<>54 then
    raise exception 'Provisional exclusive set changed: % rows (expected 54)',vc;
  end if;
end $$;

create temporary table _provisional_created on commit drop as
with b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select e.*,b.max_id+e.seq::bigint product_id,c.id category_id
from _provisional_exclusive e cross join b
left join public.commerce_preview_categories c
  on lower(btrim(c.name))=lower(btrim(e.inferred_category));

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
)
select product_id,coalesce(nullif(product_name,''),'Produto '||sku),coalesce(category_id,5),null,
       case when edition_year is not null then 'ANNUAL' else 'UNCLASSIFIED' end,
       edition_year,'DRAFT',
       concat('Mestre provisório criado no preview a partir de item exclusivo sem evidência de duplicidade. Plataforma=',platform,'; SKU=',coalesce(sku,'')),
       now(),now()
from _provisional_created;

with b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+row_number() over(order by product_id),product_id,sku,'CURRENT',edition_year,null,true,now(),now()
from _provisional_created cross join b
where nullif(btrim(sku),'') is not null;

update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview provisional exclusive Product Master')
from _provisional_created c
where r.id=c.source_row_id and r.matched_product_id is null;

do $$
declare v int;
begin
  select count(*) into v
  from public.commerce_preview_source_rows r
  join public.commerce_preview_source_files f on f.id=r.source_file_id
  where r.is_header=false and r.matched_product_id is null
    and f.id in (
      select distinct on (replace(source_code,'_GESTAO','')) id
      from public.commerce_preview_source_files
      where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
      order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
    );
  if v<>12 then raise exception 'Final manual review count changed: % (expected 12)',v; end if;
end $$;


CREATE OR REPLACE FUNCTION public.commerce_preview_management_product_summary_v2()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with base as (
  select coalesce(public.commerce_preview_management_product_summary_v1(),'{}'::jsonb) as data
),
actual_unlinked as materialized (
  select *
  from public.commerce_preview_management_products_v2(null,null,null,'UNLINKED',1000,0)
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
  join public.commerce_preview_source_rows g
    on g.source_file_id=f.id and g.is_header=false
  cross join lateral jsonb_array_elements_text(coalesce(g.normalized_payload->'sku_norms','[]'::jsonb)) x(code)
),
counts as (
  select
    coalesce(max(total_count),0) as unlinked,
    count(*) filter(where link_review_status='SAFE_CANDIDATE') as safe_candidates,
    count(*) filter(where link_review_status='AMBIGUOUS') as ambiguous_candidates,
    count(*) filter(where link_review_status='NO_CANDIDATE') as no_safe_candidate,
    count(*) filter(
      where exists (
        select 1
        from jsonb_array_elements(platforms) p
        cross join lateral jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) item
        where coalesce((item->>'sku_review_available')::boolean,false)
      )
    ) as sku_review_matches
  from actual_unlinked
)
select b.data || jsonb_build_object(
  'unlinked',c.unlinked,
  'safe_candidates',c.safe_candidates,
  'ambiguous_candidates',c.ambiguous_candidates,
  'no_safe_candidate',c.no_safe_candidate,
  'gs_reference_matches',(select count(*) from unlinked u join gs_codes g on g.code=u.sku_norm),
  'sku_review_matches',c.sku_review_matches
)
from base b
cross join counts c;
$function$;
revoke execute on function public.commerce_preview_management_product_summary_v2() from public, anon, authenticated;
grant execute on function public.commerce_preview_management_product_summary_v2() to service_role;
