create or replace function public.commerce_management_product_summary_v1()
returns jsonb
language sql
stable
security invoker
set search_path='public'
as $function$
with sources(code) as (
  values ('SHOPEE'),('ML_NOVO'),('ML_ANTIGO'),('AMAZON'),('SHEIN')
),
selected_files as (
  select
    s.code,
    (
      select f.id
      from public.commerce_source_files f
      where upper(f.source_code) in (s.code, s.code||'_GESTAO')
      order by
        case when upper(f.source_code)=s.code||'_GESTAO' then 0 else 1 end,
        f.imported_at desc nulls last,
        f.id desc
      limit 1
    ) as source_file_id
  from sources s
),
rows as (
  select sf.code, r.matched_product_id as product_id
  from selected_files sf
  join public.commerce_source_rows r
    on r.source_file_id=sf.source_file_id
   and r.is_header=false
),
presence as (
  select product_id, count(distinct code)::integer as platform_count
  from rows
  where product_id is not null
  group by product_id
)
select jsonb_build_object(
  'linked_products', (select count(*) from presence),
  'multiplatform', (select count(*) from presence where platform_count>=2),
  'exclusive', (select count(*) from presence where platform_count=1),
  'unlinked', (select count(*) from rows where product_id is null)
);
$function$;

revoke execute on function public.commerce_management_product_summary_v1() from public, anon, authenticated;
grant execute on function public.commerce_management_product_summary_v1() to service_role;

create or replace function public.commerce_preview_management_product_summary_v1()
returns jsonb
language sql
stable
security invoker
set search_path='public'
as $function$
with sources(code) as (
  values ('SHOPEE'),('ML_NOVO'),('ML_ANTIGO'),('AMAZON'),('SHEIN')
),
selected_files as (
  select
    s.code,
    (
      select f.id
      from public.commerce_preview_source_files f
      where upper(f.source_code) in (s.code, s.code||'_GESTAO')
      order by
        case when upper(f.source_code)=s.code||'_GESTAO' then 0 else 1 end,
        f.imported_at desc nulls last,
        f.id desc
      limit 1
    ) as source_file_id
  from sources s
),
rows as (
  select sf.code, r.matched_product_id as product_id
  from selected_files sf
  join public.commerce_preview_source_rows r
    on r.source_file_id=sf.source_file_id
   and r.is_header=false
),
presence as (
  select product_id, count(distinct code)::integer as platform_count
  from rows
  where product_id is not null
  group by product_id
)
select jsonb_build_object(
  'linked_products', (select count(*) from presence),
  'multiplatform', (select count(*) from presence where platform_count>=2),
  'exclusive', (select count(*) from presence where platform_count=1),
  'unlinked', (select count(*) from rows where product_id is null)
);
$function$;

revoke execute on function public.commerce_preview_management_product_summary_v1() from public, anon, authenticated;
grant execute on function public.commerce_preview_management_product_summary_v1() to service_role;
