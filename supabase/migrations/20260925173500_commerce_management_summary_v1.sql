create or replace function public.commerce_management_summary_v1(p_source_code text default 'AMAZON')
returns jsonb
language sql
stable
security invoker
set search_path = 'public'
as $function$
with first_page as (
  select *
  from public.commerce_management_rows_v1(
    p_source_code,null,null,null,null,null,null,null,null,100,0
  )
),
meta as (
  select coalesce(max(total_count),0)::integer as total
  from first_page
),
rest_pages as (
  select r.*
  from meta m
  cross join lateral generate_series(100, greatest(m.total - 1, 0), 100) as offsets(page_offset)
  cross join lateral public.commerce_management_rows_v1(
    p_source_code,null,null,null,null,null,null,null,null,100,offsets.page_offset
  ) r
),
all_rows as (
  select * from first_page
  union all
  select * from rest_pages
)
select jsonb_build_object(
  'total', count(*),
  'with_image', count(*) filter (where image_url is not null),
  'without_image', count(*) filter (where image_url is null),
  'updated', count(*) filter (where update_status='UPDATED'),
  'not_updated', count(*) filter (where update_status='NOT_UPDATED'),
  'update_review', count(*) filter (where update_status in ('REVIEW','NO_DATA')),
  'with_video', count(*) filter (where video_status='ACTIVE'),
  'without_video', count(*) filter (where video_status='ABSENT'),
  'video_review', count(*) filter (where video_status in ('UNKNOWN','NO_DATA','DISABLED')),
  'confirmed', count(*) filter (where relation_status='CONFIRMED'),
  'relation_review', count(*) filter (where relation_status='REVIEW'),
  'unmatched', count(*) filter (where relation_status='UNMATCHED'),
  'active', count(*) filter (where listing_status='ACTIVE'),
  'verify', count(*) filter (
    where relation_status <> 'CONFIRMED'
       or update_status in ('REVIEW','NO_DATA')
  )
)
from all_rows;
$function$;

revoke execute on function public.commerce_management_summary_v1(text) from public, anon, authenticated;
grant execute on function public.commerce_management_summary_v1(text) to service_role;
