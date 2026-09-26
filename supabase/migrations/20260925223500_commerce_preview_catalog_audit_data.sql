-- Final preview catalog audit data cleanup.
-- Correct exact-SKU mislinks and register marketplace SKU lineage on confirmed masters.

update public.commerce_preview_source_rows
set matched_product_id=550,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(notes,''),'preview audit correction: exact SKU AGMT26_MAN02_PBB belongs to MAN02 master #550')
where id=4950 and matched_product_id=381;

update public.commerce_preview_source_rows
set matched_product_id=331,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(notes,''),'preview audit correction: CADCONTFIN01 confirmed as Minhas Contas capa 1 via NISTI ID')
where id=3915 and matched_product_id=184;

update public.commerce_preview_source_rows
set matched_product_id=554,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(notes,''),'preview audit correction: exact SKU DIALE_FLINE_RSA_PXP overrides generic Floral Reads title')
where id in (4274,4964) and matched_product_id=173;

update public.commerce_preview_source_rows
set matched_product_id=555,
    resolution_status='PRODUCT_MATCHED',
    notes=concat_ws(' · ',nullif(notes,''),'preview audit correction: exact SKU DIALE_FNTSM_AZUL_PXP overrides generic Floral Reads title')
where id in (4275,4965) and matched_product_id=173;

create temporary table _source_aliases on commit drop as
with selected_files as (
  select distinct on (replace(source_code,'_GESTAO',''))
    id
  from public.commerce_preview_source_files
  where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
  order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
),
src as (
  select
    r.matched_product_id product_id,
    coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base','')) sku,
    regexp_replace(upper(coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''),'')),'[^A-Z0-9]+','','g') sku_norm,
    nullif(public.commerce_sku_pattern_v1(
      coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''))
    )->>'year','')::int sku_year
  from selected_files f
  join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
  where r.matched_product_id is not null
),
distinct_src as (
  select distinct on (product_id,sku_norm)
    product_id,sku,sku_norm,sku_year
  from src
  where sku_norm<>''
  order by product_id,sku_norm,length(sku) desc
)
select
  ds.product_id,ds.sku,ds.sku_norm,ds.sku_year,p.edition_year,
  case when ds.sku_year is not null and p.edition_year is not null and ds.sku_year<p.edition_year
       then 'HISTORICAL' else 'ALIAS' end sku_type,
  not (ds.sku_year is not null and p.edition_year is not null and ds.sku_year<p.edition_year) is_active
from distinct_src ds
join public.commerce_preview_products p on p.id=ds.product_id
where not exists (
  select 1 from public.commerce_preview_product_skus ps
  where ps.product_id=ds.product_id
    and regexp_replace(upper(ps.sku),'[^A-Z0-9]+','','g')=ds.sku_norm
)
and not exists (
  select 1 from public.commerce_preview_product_skus other
  where other.product_id<>ds.product_id
    and regexp_replace(upper(other.sku),'[^A-Z0-9]+','','g')=ds.sku_norm
);

do $$
declare v_count integer;
begin
  select count(*) into v_count from _source_aliases;
  if v_count<>154 then
    raise exception 'Source alias set changed: % (expected 154)',v_count;
  end if;
end $$;

with numbered as (
  select row_number() over(order by product_id,sku_norm)::bigint rn,* from _source_aliases
),
b as (
  select coalesce(max(id),0) max_id from public.commerce_preview_product_skus
)
insert into public.commerce_preview_product_skus(
  id,product_id,sku,sku_type,valid_from_year,valid_to_year,is_active,created_at,updated_at
)
select
  b.max_id+n.rn,n.product_id,n.sku,n.sku_type,n.sku_year,
  case when n.sku_type='HISTORICAL' then n.sku_year else null end,
  n.is_active,now(),now()
from numbered n cross join b;

do $$
declare v_conflicts integer;
begin
  with selected_files as (
    select distinct on (replace(source_code,'_GESTAO','')) id
    from public.commerce_preview_source_files
    where source_code in ('SHOPEE_GESTAO','ML_NOVO_GESTAO','ML_ANTIGO_GESTAO','AMAZON_GESTAO','SHEIN_GESTAO')
    order by replace(source_code,'_GESTAO',''),imported_at desc nulls last,id desc
  ),
  src as (
    select r.matched_product_id product_id,
           regexp_replace(upper(coalesce(nullif(r.normalized_payload->>'sku',''),nullif(r.normalized_payload->>'sku_base',''),'')),'[^A-Z0-9]+','','g') sku_norm
    from selected_files f
    join public.commerce_preview_source_rows r on r.source_file_id=f.id and r.is_header=false
    where r.matched_product_id is not null
  ),
  conflicts as (
    select sku_norm from src where sku_norm<>'' group by sku_norm
    having count(distinct product_id)>1
  )
  select count(*) into v_conflicts from conflicts;
  if v_conflicts<>0 then
    raise exception 'Exact source SKU conflicts remain: %',v_conflicts;
  end if;
end $$;
