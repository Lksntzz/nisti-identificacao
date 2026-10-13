begin;
create or replace function public.nisti_products_sales_planning_v1(p_nisti_ids bigint[],p_platform text default 'TODAS',p_months integer default 3)
returns jsonb language sql stable security invoker set search_path = ''
as $$
with ids as (select distinct unnest(coalesce(p_nisti_ids,array[]::bigint[])) as nisti_id),
links as (
  select distinct on (l.nisti_product_id) l.nisti_product_id,l.commerce_product_id
  from public.commerce_nisti_product_links l
  join ids on ids.nisti_id=l.nisti_product_id
  order by l.nisti_product_id,l.updated_at desc nulls last,l.commerce_product_id desc
),
report as (
  select public.commerce_product_sales_planning_v1(
    coalesce(array_agg(distinct commerce_product_id),array[]::bigint[]),p_platform,p_months
  ) as payload from links
),
records as (select item from report, lateral jsonb_array_elements(coalesce(report.payload->'items','[]'::jsonb)) item)
select jsonb_build_object(
  'period',(select payload->'period' from report),
  'items',coalesce(jsonb_agg(jsonb_set(records.item,'{nisti_product_id}',to_jsonb(links.nisti_product_id))
    order by links.nisti_product_id),'[]'::jsonb))
from records join links on links.commerce_product_id=(records.item->>'product_id')::bigint;
$$;
revoke all on function public.nisti_products_sales_planning_v1(bigint[],text,integer) from public,anon,authenticated;
grant execute on function public.nisti_products_sales_planning_v1(bigint[],text,integer) to service_role;
commit;