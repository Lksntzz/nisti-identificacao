begin;

create or replace function public.commerce_list_import_batches_v1(
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id bigint,
  marketplace_code text,
  marketplace_name text,
  source_filename text,
  status text,
  sheet_count integer,
  row_count integer,
  matched_count integer,
  conflict_count integer,
  invalid_count integer,
  created_by text,
  created_at timestamptz,
  completed_at timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.id,
    m.code,
    m.name,
    b.source_filename,
    b.status,
    b.sheet_count,
    b.row_count,
    b.matched_count,
    b.conflict_count,
    b.invalid_count,
    b.created_by,
    b.created_at,
    b.completed_at,
    count(*) over() as total_count
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id = b.marketplace_id
  order by b.created_at desc, b.id desc
  limit greatest(1, least(coalesce(p_limit, 30), 100))
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.commerce_list_import_batches_v1(integer, integer) from public, anon, authenticated;
grant execute on function public.commerce_list_import_batches_v1(integer, integer) to service_role;

commit;
