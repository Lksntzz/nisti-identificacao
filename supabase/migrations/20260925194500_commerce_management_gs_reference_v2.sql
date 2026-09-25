-- GS reference data is loaded privately into commerce_preview_source_* and is intentionally not committed to this public repository.

CREATE OR REPLACE FUNCTION public.commerce_management_link_candidates_v2(p_source_row_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select coalesce(public.commerce_management_link_candidates_v1(p_source_row_id),'{}'::jsonb)
       || jsonb_build_object('gs_reference',null);
$function$;
revoke execute on function public.commerce_management_link_candidates_v2(bigint) from public, anon, authenticated;
grant execute on function public.commerce_management_link_candidates_v2(bigint) to service_role;

CREATE OR REPLACE FUNCTION public.commerce_management_product_summary_v2()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
select coalesce(public.commerce_management_product_summary_v1(),'{}'::jsonb)
       || jsonb_build_object('gs_reference_matches',0);
$function$;
revoke execute on function public.commerce_management_product_summary_v2() from public, anon, authenticated;
grant execute on function public.commerce_management_product_summary_v2() to service_role;

CREATE OR REPLACE FUNCTION public.commerce_preview_management_link_candidates_v2(p_source_row_id bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with base as (
  select coalesce(public.commerce_preview_management_link_candidates_v1(p_source_row_id),'{}'::jsonb) as data
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
)
select b.data || jsonb_build_object(
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
  )
)
from base b;
$function$;
revoke execute on function public.commerce_preview_management_link_candidates_v2(bigint) from public, anon, authenticated;
grant execute on function public.commerce_preview_management_link_candidates_v2(bigint) to service_role;

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
  (select count(*) from unlinked u join gs_codes g on g.code=u.sku_norm)
)
from base b;
$function$;
revoke execute on function public.commerce_preview_management_product_summary_v2() from public, anon, authenticated;
grant execute on function public.commerce_preview_management_product_summary_v2() to service_role;

