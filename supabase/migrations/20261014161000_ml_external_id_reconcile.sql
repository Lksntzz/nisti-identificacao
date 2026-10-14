-- The official Mercado Livre bulk export carries ITEM_ID (MLB...), not a listing URL.
-- Accept the identifier for reconciliation, without fabricating URLs or bypassing
-- product identity, duplicate SKU checks, or the manual commit gate.
do $migration$
declare
  fn text;
  old_gate text := 'if v_listing_url is null then';
  new_gate text := $gate$if v_listing_url is null and not (
      coalesce(v_row.normalized_payload->>'marketplace','') = 'MERCADO_LIVRE'
      and upper(coalesce(v_row.normalized_payload->>'external_listing_id','')) ~ '^MLB[0-9]{6,}$'
      and coalesce(v_row.normalized_payload->>'listing_ref','') = coalesce(v_row.normalized_payload->>'external_listing_id','')
    ) then$gate$;
begin
  fn := pg_get_functiondef('public.commerce_reconcile_import_batch_v1(bigint)'::regprocedure);
  if position(old_gate in fn) = 0 then
    if position(new_gate in fn) > 0 then return; end if;
    raise exception 'Unexpected reconciliation function; migration aborted';
  end if;
  fn := replace(fn,old_gate,new_gate);
  execute fn;
end
$migration$;
