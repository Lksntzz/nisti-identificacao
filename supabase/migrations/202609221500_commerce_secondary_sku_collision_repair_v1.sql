begin;

-- Corrige um caso revelado pelas planilhas reais: sku_primary (SKU base) é a
-- identidade mestre mais forte, enquanto sku_secondary pode representar o SKU
-- observado na plataforma. Um sku_secondary reutilizado por outro produto não
-- deve transformar dois SKU base inequívocos em conflito de identidade.
create or replace function public.commerce_resolve_primary_unique_duplicate_conflicts_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_primary text;
  v_primary_rows integer;
  v_owner_count integer;
  v_product_id bigint;
  v_resolved integer := 0;
  v_matched integer;
  v_probable integer;
  v_new integer;
  v_conflict integer;
  v_invalid integer;
  v_batch_status text;
begin
  if p_batch_id is null or p_batch_id <= 0 then
    raise exception 'batch_id_invalid' using errcode = '22023';
  end if;

  if not exists(select 1 from public.commerce_import_batches where id = p_batch_id) then
    raise exception 'batch_not_found' using errcode = '22023';
  end if;

  for v_row in
    select id, normalized_payload
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status = 'CONFLICT'
      and error_code = 'duplicate_sku_in_batch'
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    if v_primary is null then
      continue;
    end if;

    -- Só repara quando o SKU base aparece em exatamente uma linha do lote.
    -- Duplicidade real de SKU base continua exigindo decisão humana.
    select count(*)::integer
    into v_primary_rows
    from public.commerce_import_rows other
    where other.batch_id = p_batch_id
      and other.status <> 'INVALID'
      and upper(btrim(coalesce(other.normalized_payload->>'sku_primary', ''))) = upper(v_primary);

    if v_primary_rows <> 1 then
      continue;
    end if;

    select count(distinct s.product_id)::integer, min(s.product_id)
    into v_owner_count, v_product_id
    from public.commerce_product_skus s
    where s.is_active = true
      and upper(btrim(s.sku)) = upper(v_primary);

    if v_owner_count <> 1 or v_product_id is null then
      continue;
    end if;

    update public.commerce_import_rows
    set
      status = 'MATCHED',
      matched_product_id = v_product_id,
      match_method = 'SKU_PRIMARY_EXACT',
      match_score = 1.00000,
      error_code = null,
      notes = concat_ws(',', nullif(notes, ''), 'secondary_sku_collision_preserved')
    where id = v_row.id;

    update public.commerce_reconciliation_candidates
    set is_confirmed = (product_id = v_product_id)
    where import_row_id = v_row.id;

    v_resolved := v_resolved + 1;
  end loop;

  select
    count(*) filter (where status = 'MATCHED')::integer,
    count(*) filter (where status = 'PROBABLE')::integer,
    count(*) filter (where status = 'NEW_PRODUCT')::integer,
    count(*) filter (where status = 'CONFLICT')::integer,
    count(*) filter (where status = 'INVALID')::integer
  into v_matched, v_probable, v_new, v_conflict, v_invalid
  from public.commerce_import_rows
  where batch_id = p_batch_id;

  v_batch_status := case
    when v_probable > 0 or v_new > 0 or v_conflict > 0 or v_invalid > 0 then 'REVIEW'
    else 'PARSED'
  end;

  update public.commerce_import_batches
  set
    status = v_batch_status,
    matched_count = v_matched,
    conflict_count = v_probable + v_conflict,
    invalid_count = v_invalid
  where id = p_batch_id;

  return jsonb_build_object(
    'batch_id', p_batch_id,
    'status', v_batch_status,
    'resolved_secondary_sku_collisions', v_resolved,
    'matched', v_matched,
    'probable', v_probable,
    'new_products', v_new,
    'conflicts', v_conflict,
    'invalid', v_invalid
  );
end;
$$;

-- Reconciliação futura aplica o reparo automaticamente após a v3.
create or replace function public.commerce_reconcile_import_batch_v4(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base jsonb;
  v_repair jsonb;
begin
  v_base := public.commerce_reconcile_import_batch_v3(p_batch_id);
  v_repair := public.commerce_resolve_primary_unique_duplicate_conflicts_v1(p_batch_id);
  return coalesce(v_base, '{}'::jsonb) || coalesce(v_repair, '{}'::jsonb);
end;
$$;

-- Commit tolera o SKU secundário observado quando ele já pertence, no catálogo
-- mestre, a outro produto. Nesse caso ele permanece apenas como platform_sku;
-- nunca é roubado/reassociado como alias global do produto confirmado.
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

  -- Sanitiza apenas MATCHED. NEW_PRODUCT já usa ON CONFLICT DO NOTHING para
  -- aliases e não tenta tomar posse de um SKU global existente.
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

  -- Se a v2 falhar, a transação inteira (inclusive a sanitização acima) volta.
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
    'secondary_sku_collisions_preserved', jsonb_object_length(v_overrides)
  );
end;
$$;

revoke all on function public.commerce_resolve_primary_unique_duplicate_conflicts_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_reconcile_import_batch_v4(bigint) from public, anon, authenticated;
revoke all on function public.commerce_commit_import_batch_v3(bigint) from public, anon, authenticated;
grant execute on function public.commerce_resolve_primary_unique_duplicate_conflicts_v1(bigint) to service_role;
grant execute on function public.commerce_reconcile_import_batch_v4(bigint) to service_role;
grant execute on function public.commerce_commit_import_batch_v3(bigint) to service_role;

-- Replica somente estas novas funções no sandbox lógico gratuito.
do $$
declare
  v_name text;
  v_definition text;
begin
  foreach v_name in array array[
    'commerce_resolve_primary_unique_duplicate_conflicts_v1',
    'commerce_reconcile_import_batch_v4',
    'commerce_commit_import_batch_v3'
  ]
  loop
    select pg_get_functiondef(p.oid)
    into v_definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_name
      and pg_get_function_identity_arguments(p.oid) = 'p_batch_id bigint'
    limit 1;

    if v_definition is null then
      raise exception 'commerce_function_clone_source_missing:%', v_name;
    end if;

    v_definition := replace(v_definition, 'commerce_', 'commerce_preview_');
    execute v_definition;
  end loop;
end;
$$;

do $$
declare
  v_signature text;
begin
  for v_signature in
    select p.oid::regprocedure::text
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'commerce_preview_resolve_primary_unique_duplicate_conflicts_v1',
        'commerce_preview_reconcile_import_batch_v4',
        'commerce_preview_commit_import_batch_v3'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;

commit;
