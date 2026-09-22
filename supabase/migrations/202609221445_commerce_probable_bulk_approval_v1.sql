begin;

create or replace function public.commerce_import_batch_v2(p_batch_id bigint)
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
    'approvable_probable_count', coalesce(s.approvable_probable_count, 0),
    'conflict_row_count', coalesce(s.conflict_row_count, 0),
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
      count(*) filter (
        where r.status = 'PROBABLE'
          and r.match_method in ('PROBABLE_CANDIDATE', 'PROBABLE_NOT_LISTED')
          and coalesce(r.match_score, 0) >= 0.95000
          and (
            select count(*)
            from public.commerce_reconciliation_candidates rc
            where rc.import_row_id = r.id
          ) = 1
          and exists (
            select 1
            from public.commerce_reconciliation_candidates rc
            join public.commerce_products p on p.id = rc.product_id
            left join public.commerce_categories c on c.id = p.category_id
            where rc.import_row_id = r.id
              and rc.rank = 1
              and rc.product_id = r.matched_product_id
              and rc.match_method = 'NAME_CATEGORY_EXACT'
              and rc.match_score >= 0.95000
              and public.commerce_match_key_v1(p.name) = public.commerce_match_key_v1(r.normalized_payload->>'product_name')
              and public.commerce_match_key_v1(c.name) = public.commerce_match_key_v1(r.normalized_payload->>'category')
          )
      )::integer as approvable_probable_count,
      count(*) filter (where r.status = 'CONFLICT')::integer as conflict_row_count,
      count(*) filter (where r.status = 'NEW_PRODUCT')::integer as new_product_count,
      count(*) filter (
        where r.status = 'NEW_PRODUCT'
          and coalesce(r.match_method, '') not in ('USER_NEW', 'USER_NEW_BULK', 'USER_NEW_BULK_NOT_LISTED')
      )::integer as unapproved_new_count,
      count(*) filter (where r.status = 'IGNORED')::integer as ignored_count,
      count(*) filter (where r.status = 'COMMITTED')::integer as committed_row_count,
      count(*) filter (
        where r.status in ('PENDING', 'PROBABLE', 'CONFLICT', 'INVALID')
          or (
            r.status = 'NEW_PRODUCT'
            and coalesce(r.match_method, '') not in ('USER_NEW', 'USER_NEW_BULK', 'USER_NEW_BULK_NOT_LISTED')
          )
      )::integer as unresolved_count
    from public.commerce_import_rows r
    where r.batch_id = b.id
  ) s on true
  where b.id = p_batch_id;
$$;

create or replace function public.commerce_approve_probable_rows_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer := 0;
  v_remaining integer := 0;
begin
  if not exists (
    select 1
    from public.commerce_import_batches
    where id = p_batch_id and status = 'REVIEW'
  ) then
    raise exception 'batch_not_in_review' using errcode = '22023';
  end if;

  with eligible as (
    select r.id, rc.product_id
    from public.commerce_import_rows r
    join public.commerce_reconciliation_candidates rc
      on rc.import_row_id = r.id
     and rc.rank = 1
    join public.commerce_products p on p.id = rc.product_id
    left join public.commerce_categories c on c.id = p.category_id
    where r.batch_id = p_batch_id
      and r.status = 'PROBABLE'
      and r.match_method in ('PROBABLE_CANDIDATE', 'PROBABLE_NOT_LISTED')
      and coalesce(r.match_score, 0) >= 0.95000
      and rc.product_id = r.matched_product_id
      and rc.match_method = 'NAME_CATEGORY_EXACT'
      and rc.match_score >= 0.95000
      and public.commerce_match_key_v1(p.name) = public.commerce_match_key_v1(r.normalized_payload->>'product_name')
      and public.commerce_match_key_v1(c.name) = public.commerce_match_key_v1(r.normalized_payload->>'category')
      and (
        select count(*)
        from public.commerce_reconciliation_candidates rc2
        where rc2.import_row_id = r.id
      ) = 1
  )
  update public.commerce_import_rows r
  set
    status = 'MATCHED',
    matched_product_id = e.product_id,
    match_method = 'USER_CONFIRMED_BULK_NAME_CATEGORY',
    match_score = 1.00000,
    error_code = null
  from eligible e
  where r.id = e.id;

  get diagnostics v_count = row_count;

  update public.commerce_reconciliation_candidates rc
  set is_confirmed = (rc.product_id = r.matched_product_id)
  from public.commerce_import_rows r
  where r.batch_id = p_batch_id
    and r.match_method = 'USER_CONFIRMED_BULK_NAME_CATEGORY'
    and rc.import_row_id = r.id;

  update public.commerce_import_batches b
  set
    matched_count = (
      select count(*)
      from public.commerce_import_rows r
      where r.batch_id = b.id and r.status = 'MATCHED'
    ),
    conflict_count = (
      select count(*)
      from public.commerce_import_rows r
      where r.batch_id = b.id and r.status in ('PROBABLE', 'CONFLICT')
    ),
    invalid_count = (
      select count(*)
      from public.commerce_import_rows r
      where r.batch_id = b.id and r.status = 'INVALID'
    ),
    status = 'REVIEW'
  where b.id = p_batch_id;

  select count(*)::integer
  into v_remaining
  from public.commerce_import_rows
  where batch_id = p_batch_id and status = 'PROBABLE';

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'approved_probable_rows', v_count,
    'remaining_probable_rows', v_remaining
  );
end;
$$;

-- Clone the new RPCs into the logical preview namespace.
do $$
declare
  r record;
  definition text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('commerce_import_batch_v2', 'commerce_approve_probable_rows_v1')
    order by p.proname
  loop
    definition := pg_get_functiondef(r.oid);
    definition := replace(definition, 'commerce_', 'commerce_preview_');
    execute definition;
  end loop;
end;
$$;

revoke all on function public.commerce_import_batch_v2(bigint) from public, anon, authenticated;
grant execute on function public.commerce_import_batch_v2(bigint) to service_role;
revoke all on function public.commerce_approve_probable_rows_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_approve_probable_rows_v1(bigint) to service_role;

revoke all on function public.commerce_preview_import_batch_v2(bigint) from public, anon, authenticated;
grant execute on function public.commerce_preview_import_batch_v2(bigint) to service_role;
revoke all on function public.commerce_preview_approve_probable_rows_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_preview_approve_probable_rows_v1(bigint) to service_role;

commit;
