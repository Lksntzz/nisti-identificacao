begin;

create or replace function public.commerce_import_batch_v1(p_batch_id bigint)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id,
    'marketplace_code', m.code,
    'marketplace_name', m.name,
    'source_filename', b.source_filename,
    'source_sha256', b.source_sha256,
    'status', b.status,
    'sheet_count', b.sheet_count,
    'row_count', b.row_count,
    'matched_count', b.matched_count,
    'conflict_count', b.conflict_count,
    'invalid_count', b.invalid_count,
    'created_by', b.created_by,
    'created_at', b.created_at,
    'completed_at', b.completed_at,
    'pending_count', coalesce(s.pending_count, 0),
    'probable_count', coalesce(s.probable_count, 0),
    'new_product_count', coalesce(s.new_product_count, 0),
    'unapproved_new_count', coalesce(s.unapproved_new_count, 0),
    'ignored_count', coalesce(s.ignored_count, 0),
    'committed_row_count', coalesce(s.committed_row_count, 0),
    'unresolved_count', coalesce(s.unresolved_count, 0),
    'can_commit', (b.status in ('PARSED', 'REVIEW') and coalesce(s.unresolved_count, 0) = 0)
  )
  from public.commerce_import_batches b
  join public.commerce_marketplaces m on m.id = b.marketplace_id
  left join lateral (
    select
      count(*) filter (where r.status = 'PENDING')::integer as pending_count,
      count(*) filter (where r.status = 'PROBABLE')::integer as probable_count,
      count(*) filter (where r.status = 'NEW_PRODUCT')::integer as new_product_count,
      count(*) filter (
        where r.status = 'NEW_PRODUCT'
          and coalesce(r.match_method, '') not in ('USER_NEW', 'USER_NEW_BULK')
      )::integer as unapproved_new_count,
      count(*) filter (where r.status = 'IGNORED')::integer as ignored_count,
      count(*) filter (where r.status = 'COMMITTED')::integer as committed_row_count,
      count(*) filter (
        where r.status in ('PENDING', 'PROBABLE', 'CONFLICT', 'INVALID')
          or (
            r.status = 'NEW_PRODUCT'
            and coalesce(r.match_method, '') not in ('USER_NEW', 'USER_NEW_BULK')
          )
      )::integer as unresolved_count
    from public.commerce_import_rows r
    where r.batch_id = b.id
  ) s on true
  where b.id = p_batch_id;
$$;

revoke all on function public.commerce_import_batch_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_import_batch_v1(bigint) to service_role;

commit;
