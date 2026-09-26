create or replace function public.commerce_preview_management_product_summary_v2()
returns jsonb
language sql
stable
security invoker
set search_path='public'
as $function$
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
unlinked as materialized (
  select
    r.id,
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
    and coalesce(r.resolution_status,'')<>'VARIATION'
),
unlinked_count as (
  select count(*)::bigint as total from unlinked
),
actual_unlinked as materialized (
  select p.*
  from unlinked_count uc
  cross join lateral public.commerce_preview_management_products_v2(
    null,null,null,'UNLINKED',1000,0
  ) p
  where uc.total>0
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
    coalesce((select total from unlinked_count),0) as unlinked,
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

revoke execute on function public.commerce_preview_management_product_summary_v2()
from public, anon, authenticated;
grant execute on function public.commerce_preview_management_product_summary_v2()
to service_role;
