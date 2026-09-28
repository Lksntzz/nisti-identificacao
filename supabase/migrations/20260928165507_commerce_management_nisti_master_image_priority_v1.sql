create or replace function public.commerce_management_products_v3(
  p_search text default null,
  p_category text default null,
  p_year integer default null,
  p_presence text default 'LINKED',
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  card_key text,
  product_id bigint,
  product_name text,
  master_sku text,
  category_name text,
  edition_year integer,
  image_url text,
  platform_count integer,
  presence_type text,
  platforms jsonb,
  link_review_status text,
  suggested_product_id bigint,
  candidate_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path='public'
as $function$
select
  b.card_key,
  b.product_id,
  b.product_name,
  b.master_sku,
  b.category_name,
  b.edition_year,
  case
    when cp.reference_image_source='NISTI_ID'
     and nullif(cp.reference_image_url,'') is not null
     and (
       nullif(cp.reference_image_sku,'') is null
       or public.commerce_image_years_compatible(b.master_sku,cp.reference_image_sku,cp.name)
     )
      then cp.reference_image_url
    else b.image_url
  end as image_url,
  b.platform_count,
  b.presence_type,
  public.commerce_enrich_management_platforms_v1(b.platforms) as platforms,
  b.link_review_status,
  b.suggested_product_id,
  b.candidate_count,
  b.total_count
from public.commerce_management_products_v2(
  p_search,p_category,p_year,p_presence,p_limit,p_offset
) b
left join public.commerce_products cp on cp.id=b.product_id;
$function$;

revoke execute on function public.commerce_management_products_v3(text,text,integer,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_management_products_v3(text,text,integer,text,integer,integer)
  to service_role;
