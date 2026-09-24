begin;

-- NEW_PRODUCT deve significar "nenhum candidato razoável encontrado", não
-- apenas "nenhum match exato". Esta camada é deliberadamente conservadora:
-- ela só transforma uma linha nova em PROBABLE e nunca confirma o vínculo.

create or replace function public.commerce_sku_yearless_family_key_v1(p_value text)
returns text
language sql
immutable
security invoker
set search_path = public
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        upper(btrim(coalesce(p_value, ''))),
        '^([A-Z]+)(20)?2[0-9]([ _-])',
        E'\\1\\3'
      ),
      '[^A-Z0-9]+',
      '',
      'g'
    ),
    ''
  );
$$;

create or replace function public.commerce_name_signal_tokens_v1(p_value text)
returns text[]
language sql
immutable
security invoker
set search_path = public
as $$
  select coalesce(array_agg(distinct token order by token), array[]::text[])
  from regexp_split_to_table(
    coalesce(public.commerce_yearless_match_key_v1(p_value), ''),
    E'\\s+'
  ) token
  where length(token) >= 3
    and token not in (
      'nisti', 'print', 'com', 'sem', 'para', 'por', 'uma', 'umas', 'uns',
      'das', 'dos', 'capa', 'dura', 'personalizada', 'personalizado', 'nome',
      'colecao', 'versao', 'atualizada', 'atualizado', 'cor', 'agenda',
      'planner', 'semanal', 'mensal', 'visao', 'ano'
    );
$$;

create or replace function public.commerce_suggest_new_product_candidates_v1(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_name text;
  v_sku text;
  v_sku_family text;
  v_tokens text[];
  v_candidate_count integer;
  v_top_product_id bigint;
  v_top_score numeric(6,5);
  v_suggested_rows integer := 0;
  v_total_candidates integer := 0;
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
      and status = 'NEW_PRODUCT'
      and coalesce(match_method, '') in ('NO_MATCH', 'NO_MATCH_NOT_LISTED')
    order by id
  loop
    v_name := nullif(btrim(coalesce(v_row.normalized_payload->>'product_name', '')), '');
    v_sku := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_sku_family := public.commerce_sku_yearless_family_key_v1(v_sku);
    v_tokens := public.commerce_name_signal_tokens_v1(v_name);

    delete from public.commerce_reconciliation_candidates
    where import_row_id = v_row.id;

    with product_signals as (
      select
        p.id as product_id,
        public.commerce_name_signal_tokens_v1(p.name) as product_tokens,
        exists (
          select 1
          from public.commerce_product_skus s
          where s.product_id = p.id
            and s.is_active = true
            and v_sku_family is not null
            and public.commerce_sku_yearless_family_key_v1(s.sku) = v_sku_family
        ) as sku_family_exact,
        exists (
          select 1
          from public.commerce_product_skus s
          cross join unnest(v_tokens) token
          where s.product_id = p.id
            and s.is_active = true
            and length(token) >= 5
            and length(regexp_replace(token, '[aeiou]', '', 'g')) >= 3
            and regexp_replace(upper(s.sku), '[^A-Z0-9]+', '', 'g') like
              '%' || upper(left(regexp_replace(token, '[aeiou]', '', 'g'), 3)) || '%'
        ) as token_sku_hint
      from public.commerce_products p
    ), overlap as (
      select
        ps.*,
        (
          select count(*)::integer
          from unnest(v_tokens) t
          where t = any(ps.product_tokens)
        ) as common_tokens,
        greatest(
          1,
          cardinality(array(
            select distinct x
            from unnest(v_tokens || ps.product_tokens) x
          ))
        ) as union_tokens
      from product_signals ps
    ), scored as (
      select
        o.*,
        (o.common_tokens::numeric / o.union_tokens::numeric) as similarity,
        case
          when o.sku_family_exact then 'SKU_YEARLESS_FAMILY'
          when o.token_sku_hint
            and o.common_tokens >= 3
            and (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.60
            then 'NAME_SIGNAL_SKU_HINT'
          when (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.95
            and o.common_tokens >= 1
            then 'NAME_SIGNAL_EXACT'
          when (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.60
            and o.common_tokens >= 2
            then 'NAME_SIGNAL_STRONG'
          when (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.45
            and o.common_tokens >= 2
            then 'NAME_SIGNAL_SIMILAR'
          else null
        end as method,
        case
          when o.sku_family_exact then 0.97000::numeric(6,5)
          when o.token_sku_hint
            and o.common_tokens >= 3
            and (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.60
            then 0.90000::numeric(6,5)
          when (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.95
            and o.common_tokens >= 1
            then 0.89000::numeric(6,5)
          when (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.60
            and o.common_tokens >= 2
            then 0.86000::numeric(6,5)
          when (o.common_tokens::numeric / o.union_tokens::numeric) >= 0.45
            and o.common_tokens >= 2
            then 0.82000::numeric(6,5)
          else null
        end as score
      from overlap o
    ), eligible as (
      select s.*
      from scored s
      where s.score is not null
        and (
          not exists(select 1 from scored x where x.sku_family_exact)
          or s.sku_family_exact
        )
    ), ranked as (
      select
        product_id,
        method,
        score,
        row_number() over(order by score desc, similarity desc, product_id)::integer as rank
      from eligible
    )
    insert into public.commerce_reconciliation_candidates (
      import_row_id, product_id, match_method, match_score, rank
    )
    select v_row.id, product_id, method, score, rank
    from ranked
    where rank <= 5
    order by rank;

    select count(*)::integer
    into v_candidate_count
    from public.commerce_reconciliation_candidates
    where import_row_id = v_row.id;

    if v_candidate_count > 0 then
      select product_id, match_score
      into v_top_product_id, v_top_score
      from public.commerce_reconciliation_candidates
      where import_row_id = v_row.id
      order by rank
      limit 1;

      update public.commerce_import_rows
      set
        status = 'PROBABLE',
        matched_product_id = v_top_product_id,
        match_method = 'SUGGESTED_EXISTING',
        match_score = v_top_score,
        error_code = null,
        notes = concat_ws(',', nullif(notes, ''), 'existing_product_suggestion_requires_review')
      where id = v_row.id;

      v_suggested_rows := v_suggested_rows + 1;
      v_total_candidates := v_total_candidates + v_candidate_count;
    end if;
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
    'suggested_rows', v_suggested_rows,
    'suggestion_candidates', v_total_candidates,
    'matched', v_matched,
    'probable', v_probable,
    'new_products', v_new,
    'conflicts', v_conflict,
    'invalid', v_invalid
  );
end;
$$;

create or replace function public.commerce_reconcile_import_batch_v5(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base jsonb;
  v_suggestions jsonb;
begin
  v_base := public.commerce_reconcile_import_batch_v4(p_batch_id);
  v_suggestions := public.commerce_suggest_new_product_candidates_v1(p_batch_id);
  return coalesce(v_base, '{}'::jsonb) || coalesce(v_suggestions, '{}'::jsonb);
end;
$$;

revoke all on function public.commerce_sku_yearless_family_key_v1(text) from public, anon, authenticated;
revoke all on function public.commerce_name_signal_tokens_v1(text) from public, anon, authenticated;
revoke all on function public.commerce_suggest_new_product_candidates_v1(bigint) from public, anon, authenticated;
revoke all on function public.commerce_reconcile_import_batch_v5(bigint) from public, anon, authenticated;
grant execute on function public.commerce_sku_yearless_family_key_v1(text) to service_role;
grant execute on function public.commerce_name_signal_tokens_v1(text) to service_role;
grant execute on function public.commerce_suggest_new_product_candidates_v1(bigint) to service_role;
grant execute on function public.commerce_reconcile_import_batch_v5(bigint) to service_role;

-- Replica estas funções no sandbox lógico gratuito.
do $$
declare
  v_name text;
  v_definition text;
begin
  foreach v_name in array array[
    'commerce_sku_yearless_family_key_v1',
    'commerce_name_signal_tokens_v1',
    'commerce_suggest_new_product_candidates_v1',
    'commerce_reconcile_import_batch_v5'
  ]
  loop
    select pg_get_functiondef(p.oid)
    into v_definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = v_name
    order by p.oid desc
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
        'commerce_preview_sku_yearless_family_key_v1',
        'commerce_preview_name_signal_tokens_v1',
        'commerce_preview_suggest_new_product_candidates_v1',
        'commerce_preview_reconcile_import_batch_v5'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);
  end loop;
end;
$$;

commit;
