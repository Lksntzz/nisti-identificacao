begin;

create or replace function public.commerce_commit_import_batch_v3(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_secondary text;
  v_primary text;
  v_secondary_owner bigint;
  v_overrides jsonb := '{}'::jsonb;
  v_entry record;
  v_row_id bigint;
  v_result jsonb;
begin
  if p_batch_id is null or p_batch_id <= 0 then
    raise exception 'batch_id_invalid' using errcode = '22023';
  end if;

  for v_row in
    select id, matched_product_id, normalized_payload
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status = 'MATCHED'
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_secondary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary', '')), '');

    if v_secondary is null or v_primary is null or upper(v_secondary) = upper(v_primary) then
      continue;
    end if;

    select product_id
    into v_secondary_owner
    from public.commerce_product_skus
    where is_active = true
      and upper(btrim(sku)) = upper(v_secondary)
    limit 1;

    if v_secondary_owner is null or v_secondary_owner = v_row.matched_product_id then
      continue;
    end if;

    v_overrides := v_overrides || jsonb_build_object(
      v_row.id::text,
      jsonb_build_object(
        'secondary', v_secondary,
        'primary', v_primary,
        'owner', v_secondary_owner
      )
    );

    update public.commerce_import_rows
    set normalized_payload = normalized_payload - 'sku_secondary'
    where id = v_row.id;
  end loop;

  v_result := public.commerce_commit_import_batch_v2(p_batch_id);

  for v_entry in select key, value from jsonb_each(v_overrides)
  loop
    v_row_id := v_entry.key::bigint;
    v_secondary := v_entry.value->>'secondary';
    v_primary := v_entry.value->>'primary';
    v_secondary_owner := (v_entry.value->>'owner')::bigint;

    update public.commerce_import_rows
    set
      normalized_payload = jsonb_set(normalized_payload, '{sku_secondary}', to_jsonb(v_secondary), true),
      notes = concat_ws(',', nullif(notes, ''), format('platform_sku_owned_by_product:%s', v_secondary_owner))
    where id = v_row_id;

    update public.commerce_listing_products lp
    set
      platform_sku = v_secondary,
      product_sku_id = null
    from public.commerce_import_rows r
    where r.id = v_row_id
      and r.matched_listing_id is not null
      and lp.listing_id = r.matched_listing_id
      and lp.product_id = r.matched_product_id
      and upper(btrim(coalesce(lp.platform_sku, ''))) = upper(v_primary);
  end loop;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'secondary_sku_collisions_preserved', (
      select count(*)::integer from jsonb_object_keys(v_overrides)
    )
  );
end;
$$;

revoke all on function public.commerce_commit_import_batch_v3(bigint) from public, anon, authenticated;
grant execute on function public.commerce_commit_import_batch_v3(bigint) to service_role;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid)
  into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'commerce_commit_import_batch_v3'
    and pg_get_function_identity_arguments(p.oid) = 'p_batch_id bigint'
  limit 1;

  v_definition := replace(v_definition, 'commerce_', 'commerce_preview_');
  execute v_definition;
end;
$$;

revoke all on function public.commerce_preview_commit_import_batch_v3(bigint) from public, anon, authenticated;
grant execute on function public.commerce_preview_commit_import_batch_v3(bigint) to service_role;

commit;
