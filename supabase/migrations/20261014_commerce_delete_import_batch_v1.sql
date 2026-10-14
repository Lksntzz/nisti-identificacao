-- Delete only import staging/review data. Once committed, never remove audit history here.
create or replace function public.commerce_delete_import_batch_v1(p_batch_id bigint)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_status text; v_filename text; v_rows integer;
begin
  if p_batch_id is null or p_batch_id<=0 then
    raise exception 'invalid_import_batch_id' using errcode='22023';
  end if;
  select status,source_filename into v_status,v_filename
  from public.commerce_import_batches where id=p_batch_id for update;
  if not found then raise exception 'import_batch_not_found' using errcode='22023'; end if;
  if v_status in ('COMMITTED') or exists(
    select 1 from public.commerce_import_rows
    where batch_id=p_batch_id and status='COMMITTED'
  ) then raise exception 'committed_import_cannot_be_deleted' using errcode='22023'; end if;
  select count(*) into v_rows from public.commerce_import_rows where batch_id=p_batch_id;
  delete from public.commerce_import_batches where id=p_batch_id;
  return jsonb_build_object('deleted',true,'batch_id',p_batch_id,'removed_rows',v_rows,'source_filename',v_filename);
end $$;
revoke execute on function public.commerce_delete_import_batch_v1(bigint) from public,anon,authenticated;
grant execute on function public.commerce_delete_import_batch_v1(bigint) to service_role;
