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
     or nullif(l.sku_pattern->>'signature','') is null
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


-- Preview-only catalog reconciliation using company SKU cover rules and the GS reference catalog.
-- Safety rules:
--   * exact cover may ignore year and final finishing token;
--   * cover variant remains part of identity (JPH1 != JPH2);
--   * cover collection/base is review-only;
--   * GS auto-creation requires one source row -> one GS product, active valid GTIN and no existing master.

-- 1) Merge duplicate Product Masters already proven to be the same cover/version lineage.
create temporary table _merge_map(
  duplicate_id bigint primary key,
  canonical_id bigint not null
) on commit drop;

insert into _merge_map values
  (446,69),(448,55),(449,10),(450,83),(453,62),
  (454,19),(455,15),(456,64),(6,458),(477,51);

update public.commerce_preview_products
set name='Nisti Print Agenda 2026 Capa Dura Personalizada com nome Spring Breeze',
    edition_year=2026,
    updated_at=now()
where id=15;

update public.commerce_preview_products
set name='Nisti Print Agenda 2026 Capa Dura Executiva Coleção Minimalist Leaves',
    updated_at=now()
where id=458;

update public.commerce_preview_source_rows r
set matched_product_id=m.canonical_id,
    notes=concat_ws(' · ',nullif(r.notes,''),'preview master merge: #'||m.duplicate_id||' -> #'||m.canonical_id)
from _merge_map m
where r.matched_product_id=m.duplicate_id;

update public.commerce_preview_import_rows r
set matched_product_id=m.canonical_id
from _merge_map m
where r.matched_product_id=m.duplicate_id;

update public.commerce_preview_listing_products r
set product_id=m.canonical_id,updated_at=now()
from _merge_map m
where r.product_id=m.duplicate_id;

update public.commerce_preview_product_state_events r
set product_id=m.canonical_id
from _merge_map m
where r.product_id=m.duplicate_id;

delete from public.commerce_preview_reconciliation_candidates d
using _merge_map m
where d.product_id=m.duplicate_id
  and exists (
    select 1 from public.commerce_preview_reconciliation_candidates c
    where c.import_row_id=d.import_row_id and c.product_id=m.canonical_id
  );

update public.commerce_preview_reconciliation_candidates r
set product_id=m.canonical_id
from _merge_map m
where r.product_id=m.duplicate_id;

delete from public.commerce_preview_product_media_links d
using _merge_map m
where d.product_id=m.duplicate_id
  and exists (
    select 1 from public.commerce_preview_product_media_links c
    where c.product_id=m.canonical_id and c.source_kind=d.source_kind
  );

update public.commerce_preview_product_media_links r
set product_id=m.canonical_id,updated_at=now()
from _merge_map m
where r.product_id=m.duplicate_id;

delete from public.commerce_preview_product_skus d
using _merge_map m
where d.product_id=m.duplicate_id
  and exists (
    select 1 from public.commerce_preview_product_skus c
    where c.product_id=m.canonical_id
      and regexp_replace(upper(c.sku),'[^A-Z0-9]+','','g')
          =regexp_replace(upper(d.sku),'[^A-Z0-9]+','','g')
  );

update public.commerce_preview_product_skus s
set product_id=m.canonical_id,sku_type='HISTORICAL',is_active=false,updated_at=now()
from _merge_map m
where s.product_id=m.duplicate_id;

delete from public.commerce_preview_products p
using _merge_map m
where p.id=m.duplicate_id;

-- 2) Create missing exact-cover masters detected before the GS bulk stage.
create temporary table _cover_defs(
  seq int primary key,
  name text not null,
  category_id bigint,
  temporal_type text not null,
  edition_year int,
  current_sku text not null,
  source_row_ids bigint[] not null,
  historical_sku text
) on commit drop;

insert into _cover_defs values
  (1,'Agenda Manicure E Pedicure Para Agendamentos - Capa Dura - Cor Da Capa Preta',1,'ANNUAL',2026,'AGMT26_MAN02_PBB',array[3648,3964]::bigint[],'AGMT24 MAN02 RBB'),
  (2,'Nisti Print Agenda Manicure 2027 Pedicure Agendamentos com Pagamento - CAPA 1',1,'ANNUAL',2027,'AGMT27_MANI1_BBB',array[5105]::bigint[],null),
  (3,'Nisti Print Agenda Manicure 2027 Pedicure Agendamentos com Pagamento - CAPA 2',1,'ANNUAL',2027,'AGMT27_MANI2_PBP',array[4911]::bigint[],null),
  (4,'Nisti Print Agenda Manicure 2027 Pedicure Agendamentos com Pagamento - CAPA 3',1,'ANNUAL',2027,'AGMT27_MANI3_BBB',array[5104]::bigint[],null),
  (5,'Nisti Print Caderno Diário de Leitura Para Resenhas Feline Vibes Rosa',3,'UNCLASSIFIED',null,'DIALE_FLINE_RSA_PXP',array[3807,3986]::bigint[],null),
  (6,'Nisti Print Caderno Diário de Leitura Para Resenhas Phantom Azul',3,'UNCLASSIFIED',null,'DIALE_FNTSM_AZUL_PXP',array[3809,3985]::bigint[],null),
  (7,'Agenda 2025 Capa Dura Personalizada com nome Florescer Azul',1,'ANNUAL',2025,'PB25_FLRCAZ_PXP',array[4306]::bigint[],null),
  (8,'Agenda 2025 Capa Dura Personalizada com nome Florescer Rosa',1,'ANNUAL',2025,'PB25_FLRCRS_PXP',array[4119]::bigint[],null),
  (9,'Agenda 2025 Capa Dura Personalizada com nome Florescer Verde',1,'ANNUAL',2025,'PB25_FLRCVD_PXP',array[4307]::bigint[],null);

create temporary table _cover_created on commit drop as
with missing as (
  select d.*,row_number() over(order by d.seq)::bigint rn
  from _cover_defs d
  where not exists (
    select 1 from public.commerce_preview_product_skus ps
    where regexp_replace(upper(ps.sku),'[^A-Z0-9]+','','g')
          =regexp_replace(upper(d.current_sku),'[^A-Z0-9]+','','g')
  )
),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select m.*,b.max_id+m.rn product_id
from missing m cross join b;

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
)
select product_id,name,category_id,null,temporal_type,edition_year,'DRAFT',
       'Criado no preview por padrão SKU/capa. Capa específica preservada; ano/acabamento tratados como versão.',
       now(),now()
from _cover_created;

with rows as (
  select product_id,current_sku sku,'CURRENT'::text sku_type,edition_year,1 ord from _cover_created
  union all
  select product_id,historical_sku,'HISTORICAL',2024,2 from _cover_created where historical_sku is not null
),
n as (
  select row_number() over(order by product_id,ord)::bigint rn,* from rows
),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+n.rn,n.product_id,n.sku,n.sku_type,n.edition_year,
       case when n.sku_type='HISTORICAL' then n.edition_year else null end,
       n.sku_type='CURRENT',now(),now()
from n cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview new Product Master from exact SKU cover')
from _cover_created c
where r.id=any(c.source_row_ids) and r.matched_product_id is null;

-- 3) Bulk-create Product Masters for unlinked source rows that map to exactly one GS product.
create temporary table _eligible_gs on commit drop as
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id,replace(source_code,'_GESTAO','') platform
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
unlinked as (
  select f.platform,r.id source_row_id,
         coalesce(nullif(r.normalized_payload->>'category',''),'Outros') category_name,
         regexp_replace(upper(coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''),'')),'[^A-Z0-9]+','','g') sku_norm
  from selected_files f
  join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
gs_file as (
  select id from public.commerce_preview_source_files
  where source_code='GS_REFERENCIA'
  order by imported_at desc nulls last,id desc limit 1
),
matches as (
  select u.*,g.id gs_row_id,g.normalized_payload gs
  from unlinked u
  join gs_file f on true
  join public.commerce_preview_source_rows g
    on g.source_file_id=f.id and g.is_header=false
   and exists (
     select 1 from jsonb_array_elements_text(coalesce(g.normalized_payload->'sku_norms','[]'::jsonb)) x(code)
     where x.code=u.sku_norm
   )
),
counts as (
  select source_row_id,count(distinct gs_row_id)::int n
  from matches group by source_row_id
),
eligible as (
  select m.*
  from matches m
  join counts c on c.source_row_id=m.source_row_id and c.n=1
  where m.gs->>'status'='Ativo'
    and nullif(m.gs->>'gtin','') is not null
    and m.gs->>'gtin'<>'305'
)
select
  row_number() over(order by e.gs_row_id)::int seq,
  e.source_row_id,e.category_name,e.gs_row_id,e.gs,
  coalesce(nullif(e.gs->'sku_all'->>0,''),nullif(e.gs->>'sku','')) current_sku,
  coalesce(
    nullif(public.commerce_sku_pattern_v1(coalesce(nullif(e.gs->'sku_all'->>0,''),nullif(e.gs->>'sku','')))->>'year','')::int,
    nullif(substring(coalesce(e.gs->>'product_name','') from '(20[0-9]{2})'),'')::int
  ) edition_year
from eligible e
where not exists (
  select 1
  from public.commerce_preview_product_skus ps
  cross join lateral jsonb_array_elements_text(coalesce(e.gs->'sku_norms','[]'::jsonb)) x(code)
  where regexp_replace(upper(ps.sku),'[^A-Z0-9]+','','g')=x.code
);

create temporary table _gs_created on commit drop as
with b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select e.*,b.max_id+row_number() over(order by e.seq)::bigint product_id,c.id category_id
from _eligible_gs e
cross join b
left join public.commerce_preview_categories c
  on lower(btrim(c.name))=lower(btrim(e.category_name));

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
)
select product_id,coalesce(nullif(gs->>'product_name',''),'Produto GS '||product_id),
       coalesce(category_id,5),null,
       case when edition_year is not null then 'ANNUAL' else 'UNCLASSIFIED' end,
       edition_year,'DRAFT',
       concat('Criado no preview pelo catálogo GS. GTIN=',coalesce(gs->>'gtin',''),
              '; GS_ROW=',gs_row_id,'; SKU=',coalesce(current_sku,'')),
       now(),now()
from _gs_created;

with src as (
  select c.product_id,a.ordinality::int ord,a.sku,c.edition_year
  from _gs_created c
  cross join lateral jsonb_array_elements_text(coalesce(c.gs->'sku_all','[]'::jsonb))
    with ordinality a(sku,ordinality)
  where btrim(a.sku)<>''
),
fallback as (
  select c.product_id,1 ord,c.current_sku sku,c.edition_year
  from _gs_created c
  where c.current_sku is not null
    and not exists (select 1 from src s where s.product_id=c.product_id)
),
all_skus as (
  select * from src union all select * from fallback
),
dedup as (
  select distinct on (product_id,regexp_replace(upper(sku),'[^A-Z0-9]+','','g'))
    product_id,ord,sku,edition_year
  from all_skus
  order by product_id,regexp_replace(upper(sku),'[^A-Z0-9]+','','g'),ord
),
n as (
  select row_number() over(order by product_id,ord,sku)::bigint rn,* from dedup
),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+n.rn,n.product_id,n.sku,case when n.ord=1 then 'CURRENT' else 'ALIAS' end,
       n.edition_year,null,true,now(),now()
from n cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview Product Master created from unique GS SKU/GTIN')
from _gs_created c
where r.id=c.source_row_id and r.matched_product_id is null;

update public.commerce_preview_source_rows g
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(g.notes,''),'preview GS catalog identity linked to Product Master')
from _gs_created c
where g.id=c.gs_row_id and g.matched_product_id is null;

-- 4) GS duplicate-SKU disambiguation: marketplace title says "Personalizado c/ Nome", not "Para Resenhas".
create temporary table _dorama_defs(
  seq int primary key,gs_row_id bigint,gtin text,sku text,name text,source_row_ids bigint[]
) on commit drop;
insert into _dorama_defs values
  (1,5298,'7898764980569','CDRAMA_FRVER_AZL_PXP',
   'Nisti Print Caderno Diário de Doramas Personalizado c/ Nome Forever - Azul',
   array[3988,4271,4986]::bigint[]),
  (2,5300,'7898764980583','CDRAMA_FRVER_AMRLO_PXP',
   'Nisti Print Caderno Diário de Doramas Personalizado c/ Nome Forever - Amarelo',
   array[3989,4270,4987]::bigint[]);

create temporary table _dorama_created on commit drop as
with missing as (
  select d.*,row_number() over(order by d.seq)::bigint rn
  from _dorama_defs d
  where not exists (
    select 1 from public.commerce_preview_product_skus ps
    where regexp_replace(upper(ps.sku),'[^A-Z0-9]+','','g')
          =regexp_replace(upper(d.sku),'[^A-Z0-9]+','','g')
  )
),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select m.*,b.max_id+m.rn product_id from missing m cross join b;

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes,created_at,updated_at
)
select product_id,name,3,null,'UNCLASSIFIED',null,'DRAFT',
       concat('Criado no preview por desambiguação GS nome+SKU. GTIN=',gtin,'; GS_ROW=',gs_row_id),
       now(),now()
from _dorama_created;

with b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+row_number() over(order by c.product_id),c.product_id,c.sku,'CURRENT',null,null,true,now(),now()
from _dorama_created c cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview GS disambiguation by exact product name: Personalizado c/ Nome')
from _dorama_created c
where r.id=any(c.source_row_ids) and r.matched_product_id is null;

update public.commerce_preview_source_rows g
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(g.notes,''),'preview GS identity selected by exact product name')
from _dorama_created c
where g.id=c.gs_row_id and g.matched_product_id is null;

-- 5) Re-run the exact-cover rule after new masters exist.
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
unlinked as (
  select r.id source_row_id,
         public.commerce_sku_pattern_v1(
           coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))
         )->>'signature' signature
  from selected_files f
  join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
candidates as (
  select u.source_row_id,min(ps.product_id) product_id,count(distinct ps.product_id)::int candidate_count
  from unlinked u
  join public.commerce_preview_product_skus ps
    on public.commerce_sku_pattern_v1(ps.sku)->>'signature'=u.signature
   and nullif(u.signature,'') is not null
  group by u.source_row_id
)
update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview SKU exact-cover link after GS master creation')
from candidates c
where c.candidate_count=1
  and r.id=c.source_row_id
  and r.matched_product_id is null;
