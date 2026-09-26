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
from public,anon,authenticated;
grant execute on function public.commerce_preview_management_products_v2(text,text,integer,text,integer,integer)
to service_role;



-- Final preview-only reconciliation of the last manual-review rows.
-- The live commerce tables are not touched.

-- Generic Safari listing: same family and generic Safari cover as NISTI ID #150 / PM #233.
update public.commerce_preview_source_rows
set matched_product_id=233,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(notes,''),
      'preview Safari generic match: VACMNO SAF BVV -> VACMNO_SFR_BVV / NISTI ID #150'
    )
where id=3658
  and matched_product_id is null;

-- PTD180_EPND_BBB is a structural parent listing. The actual Product Masters are
-- EPND1/EPND2/EPND3, so the parent must not become a fourth Product Master.
update public.commerce_preview_source_rows
set resolution_status='VARIATION',
    notes=concat_ws(' · ',nullif(notes,''),
      'preview structural parent: PTD180_EPND_BBB aggregates EPND1/EPND2/EPND3; excluded from Product Master queue'
    )
where id=4908
  and matched_product_id is null;

-- Girls school agenda cover mapping. Each specific cover gets its own Product Master.
-- CAPA 02 = CAST is explicitly identified by the NISTI/Magalu product metadata.
-- CAPA 03 and 04 were visually reconciled against the official cover artwork;
-- CAPA 05 is the remaining CACH variation after the five-cover set is reconciled.
create temporary table _girls_map(
  seq int primary key,
  cover_num int not null,
  cover_code text not null,
  cover_label text not null,
  amazon_row bigint not null,
  shopee_row bigint not null,
  current_sku text not null,
  amazon_sku text not null,
  evidence text not null
) on commit drop;

insert into _girls_map values
  (1,2,'CAST','Cabelo Castanho',3638,4934,'CADMNA CAST BA','AGESCINMA_02',
   'Magalu/NISTI ficha técnica Capa 02: Modelo Cabelo Castanho'),
  (2,3,'LOI','Cabelo Loiro',3639,4936,'CADMNA LOI BA','AGESCINMA_03',
   'reconciliação visual Capa 03 com arte oficial loira'),
  (3,4,'RUI','Cabelo Ruivo',3640,4937,'CADMNA RUI BA','AGESCINMA_04',
   'reconciliação visual Capa 04 com arte oficial ruiva'),
  (4,5,'CACH','Cabelo Preto Cacheado',3641,4935,'CADMNA CACH BA','AGESCINMA_05',
   'capa remanescente após mapeamento completo das cinco variações');

create temporary table _girls_created on commit drop as
with eligible as (
  select g.*,row_number() over(order by g.seq)::bigint rn
  from _girls_map g
  where (select count(*)
         from public.commerce_preview_source_rows r
         where r.id in (g.amazon_row,g.shopee_row)
           and r.matched_product_id is null)=2
    and not exists (
      select 1
      from public.commerce_preview_product_skus ps
      where regexp_replace(upper(ps.sku),'[^A-Z0-9]+','','g')
            =regexp_replace(upper(g.current_sku),'[^A-Z0-9]+','','g')
    )
),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select e.*,b.max_id+e.rn product_id
from eligible e cross join b;

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,
  internal_status,notes,created_at,updated_at
)
select
  product_id,
  'Agenda Escolar Infantil Permanente - Meninas - CAPA '||cover_num||' - '||cover_label,
  1,null,'UNCLASSIFIED',null,'DRAFT',
  'Criado no preview por reconciliação de capa Amazon/Shopee. '||evidence,
  now(),now()
from _girls_created;

with x as (
  select product_id,current_sku sku,'CURRENT'::text sku_type,1 ord from _girls_created
  union all
  select product_id,amazon_sku,'ALIAS',2 from _girls_created
),
n as (select row_number() over(order by product_id,ord)::bigint rn,* from x),
b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select b.max_id+n.rn,n.product_id,n.sku,n.sku_type,null,null,true,now(),now()
from n cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=g.product_id,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),
      'preview agenda escolar meninas: Amazon CAPA '||lpad(g.cover_num::text,2,'0')||
      ' ↔ Shopee '||g.cover_code||' ('||g.cover_label||')'
    )
from _girls_created g
where r.id in (g.amazon_row,g.shopee_row)
  and r.matched_product_id is null;

-- PLAN|MPO is the same exact cover lineage. MPW is the separate White cover code;
-- therefore the Shopee White/2025 title is treated as inconsistent metadata, not identity.
do $$
declare v int; vp bigint; vb bigint;
begin
  select count(*) into v
  from public.commerce_preview_source_rows
  where id in (3811,4959) and matched_product_id is null;

  if v=2 then
    select coalesce(max(id),0)+1 into vp
    from public.commerce_preview_products;

    insert into public.commerce_preview_products(
      id,name,category_id,subcategory_id,temporal_type,edition_year,
      internal_status,notes,created_at,updated_at
    ) values (
      vp,
      'Planner Semanal e Mensal - My Planner - Orange',
      2,null,'ANNUAL',2026,'DRAFT',
      'Criado no preview por capa exata PLAN|MPO. Amazon identifica Orange; Shopee usa o mesmo SKU/capa MPO mas título White/2025 inconsistente. SKU preservado como evidência principal.',
      now(),now()
    );

    select coalesce(max(id),0) into vb
    from public.commerce_preview_product_skus;

    insert into public.commerce_preview_product_skus(
      id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
    ) values
      (vb+1,vp,'PLAN26 MPO PBP','CURRENT',2026,null,true,now(),now()),
      (vb+2,vp,'PLAN24 MPO PBP','HISTORICAL',2024,2024,false,now(),now());

    update public.commerce_preview_source_rows
    set matched_product_id=vp,
        resolution_status='PRODUCT_MATCHED',
        notes=concat_ws(' · ',nullif(notes,''),
          case id
            when 3811 then 'preview PLAN|MPO exact-cover lineage: Amazon 2024 Orange'
            when 4959 then 'preview PLAN|MPO exact-cover lineage: Shopee title says White/2025 but SKU identifies MPO/2026; preserve platform data for correction'
          end
        )
    where id in (3811,4959)
      and matched_product_id is null;
  end if;
end $$;

do $$
declare v int;
begin
  select count(*) into v
  from public.commerce_preview_source_rows r
  join public.commerce_preview_source_files f on f.id=r.source_file_id
  where r.is_header=false
    and r.matched_product_id is null
    and r.resolution_status<>'VARIATION'
    and f.id in (
      select distinct on (replace(source_code,'_GESTAO','')) id
      from public.commerce_preview_source_files
      where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
      order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
    );

  if v<>0 then
    raise exception 'Final Product Master queue not empty: % rows',v;
  end if;
end $$;
