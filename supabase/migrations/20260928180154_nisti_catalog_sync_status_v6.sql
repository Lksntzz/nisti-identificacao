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
with base as (
  select
    b.*,
    cp.reference_image_url,
    cp.reference_image_source,
    cp.reference_image_sku,
    exists(
      select 1
      from public.commerce_nisti_product_links l
      where l.commerce_product_id=b.product_id
        and l.sync_status='SYNCED'
    ) as has_nisti_link,
    case
      when cp.reference_image_source='NISTI_ID'
       and nullif(cp.reference_image_url,'') is not null
        then cp.reference_image_url
      else b.image_url
    end as effective_image_url
  from public.commerce_management_products_v2(
    p_search,p_category,p_year,p_presence,p_limit,p_offset
  ) b
  left join public.commerce_products cp on cp.id=b.product_id
)
select
  b.card_key,
  b.product_id,
  b.product_name,
  b.master_sku,
  b.category_name,
  b.edition_year,
  b.effective_image_url as image_url,
  b.platform_count,
  b.presence_type,
  public.commerce_sync_management_platforms_to_nisti_v2(
    public.commerce_enrich_management_platforms_v1(b.platforms),
    b.product_id,
    b.master_sku,
    b.edition_year,
    case when b.reference_image_source='NISTI_ID' then b.reference_image_url else null end
  ) as platforms,
  case
    when b.product_id is not null and b.has_nisti_link then 'NISTI_SYNCED'
    when b.product_id is not null then 'NISTI_PENDING'
    else b.link_review_status
  end as link_review_status,
  b.suggested_product_id,
  b.candidate_count,
  b.total_count
from base b;
$function$;

revoke execute on function public.commerce_management_products_v3(text,text,integer,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_management_products_v3(text,text,integer,text,integer,integer)
  to service_role;

create or replace function public.commerce_management_product_summary_v2()
returns jsonb
language sql
stable
security invoker
set search_path='public'
as $function$
with base as (
  select coalesce(public.commerce_management_product_summary_v1(),'{}'::jsonb) as data
),
catalog as (
  select r.*
  from generate_series(0,700,100) o(offset_value)
  cross join lateral public.commerce_management_products_v3(
    null,null,null,'LINKED',100,o.offset_value
  ) r
),
status_counts as (
  select
    count(distinct product_id) filter(where link_review_status='NISTI_SYNCED')::bigint as nisti_synced,
    count(distinct product_id) filter(where link_review_status='NISTI_PENDING')::bigint as nisti_pending
  from catalog
  where product_id is not null
)
select b.data || jsonb_build_object(
  'nisti_synced',coalesce(s.nisti_synced,0),
  'nisti_pending',coalesce(s.nisti_pending,0)
)
from base b
cross join status_counts s;
$function$;

revoke execute on function public.commerce_management_product_summary_v2()
  from public,anon,authenticated;
grant execute on function public.commerce_management_product_summary_v2()
  to service_role;
