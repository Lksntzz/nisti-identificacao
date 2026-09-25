
-- Preview-only: create a Product Master when an unlinked marketplace row has exactly
-- one NISTI ID product with the same family + exact cover signature.
-- Year and finishing token may differ; cover variant remains exact.

create temporary table _nisti_exact on commit drop as
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id,replace(source_code,'_GESTAO','') platform
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
unlinked as (
  select
    f.platform,
    r.id source_row_id,
    coalesce(nullif(r.normalized_payload->>'category',''),'Outros') category_name,
    public.commerce_sku_pattern_v1(
      coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))
    ) pattern
  from selected_files f
  join public.commerce_preview_source_rows r
    on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is null
),
matches as (
  select
    u.source_row_id,u.category_name,
    p.id nisti_product_id,p.sku,p.nome,p.variacao,p.image_key,
    public.commerce_sku_pattern_v1(p.sku) nisti_pattern
  from unlinked u
  join public.products p
    on public.commerce_sku_pattern_v1(p.sku)->>'signature'=u.pattern->>'signature'
   and nullif(u.pattern->>'signature','') is not null
),
counts as (
  select source_row_id,count(distinct nisti_product_id)::int n
  from matches
  group by source_row_id
),
eligible as (
  select m.*
  from matches m
  join counts c using(source_row_id)
  where c.n=1
    and not exists (
      select 1
      from public.commerce_preview_product_media_links pml
      where pml.source_kind='NISTI_ID'
        and pml.source_product_id=m.nisti_product_id
    )
    and not exists (
      select 1
      from public.commerce_preview_product_skus ps
      where regexp_replace(upper(ps.sku),'[^A-Z0-9]+','','g')
            =regexp_replace(upper(m.sku),'[^A-Z0-9]+','','g')
    )
),
grouped as (
  select
    nisti_product_id,
    min(category_name) category_name,
    min(sku) sku,
    min(nome) nome,
    min(variacao) variacao,
    min(image_key) image_key,
    array_agg(distinct source_row_id order by source_row_id) source_row_ids
  from eligible
  group by nisti_product_id
)
select
  row_number() over(order by g.nisti_product_id)::int seq,
  g.*,
  c.id category_id,
  nullif(public.commerce_sku_pattern_v1(g.sku)->>'year','')::int edition_year
from grouped g
left join public.commerce_preview_categories c
  on lower(btrim(c.name))=lower(btrim(g.category_name));

create temporary table _nisti_created on commit drop as
with b as (select coalesce(max(id),0) max_id from public.commerce_preview_products)
select e.*,b.max_id+e.seq::bigint product_id
from _nisti_exact e cross join b;

insert into public.commerce_preview_products(
  id,name,category_id,subcategory_id,temporal_type,edition_year,
  internal_status,notes,created_at,updated_at
)
select
  product_id,
  concat_ws(' - ',nullif(nome,''),nullif(variacao,'')),
  coalesce(category_id,5),
  null,
  case when edition_year is not null then 'ANNUAL' else 'UNCLASSIFIED' end,
  edition_year,
  'DRAFT',
  concat('Criado no preview por match exato de capa com NISTI ID. NISTI_PRODUCT_ID=',nisti_product_id,'; SKU=',sku),
  now(),now()
from _nisti_created;

with b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_skus)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select
  b.max_id+row_number() over(order by c.product_id),
  c.product_id,c.sku,'CURRENT',c.edition_year,null,true,now(),now()
from _nisti_created c cross join b;

with b as (select coalesce(max(id),0) max_id from public.commerce_preview_product_media_links)
insert into public.commerce_preview_product_media_links(
  id,product_id,source_kind,source_product_id,matched_sku,image_key,created_at,updated_at
)
select
  b.max_id+row_number() over(order by c.product_id),
  c.product_id,'NISTI_ID',c.nisti_product_id,c.sku,c.image_key,now(),now()
from _nisti_created c cross join b;

update public.commerce_preview_source_rows r
set matched_product_id=c.product_id,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(r.notes,''),'preview exact-cover match to NISTI ID')
from _nisti_created c
where r.id=any(c.source_row_ids)
  and r.matched_product_id is null;
