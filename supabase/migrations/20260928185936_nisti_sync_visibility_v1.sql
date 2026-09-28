create or replace function public.commerce_nisti_product_statuses_v1()
returns table(
  nisti_product_id bigint,
  commerce_product_id bigint,
  source_sku text,
  sync_status text,
  last_error text,
  last_synced_at timestamptz,
  commerce_sku text,
  commerce_name text
)
language sql
stable
security invoker
set search_path='public'
as $function$
select
  l.nisti_product_id,
  l.commerce_product_id,
  l.source_sku,
  l.sync_status,
  l.last_error,
  l.last_synced_at,
  cur.sku as commerce_sku,
  cp.name as commerce_name
from public.commerce_nisti_product_links l
left join public.commerce_products cp
  on cp.id=l.commerce_product_id
left join lateral (
  select ps.sku
  from public.commerce_product_skus ps
  where ps.product_id=l.commerce_product_id
  order by
    case when ps.sku_type='CURRENT' and ps.is_active then 0
         when ps.is_active then 1
         else 2 end,
    ps.id
  limit 1
) cur on true
order by l.nisti_product_id;
$function$;

revoke execute on function public.commerce_nisti_product_statuses_v1()
  from public,anon,authenticated;
grant execute on function public.commerce_nisti_product_statuses_v1()
  to service_role;
