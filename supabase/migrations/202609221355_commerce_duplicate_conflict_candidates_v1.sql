begin;

create or replace function public.commerce_reconcile_import_batch_v3(p_batch_id bigint)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_result jsonb;
  v_row record;
  v_primary text;
  v_secondary text;
  v_name text;
  v_category text;
  v_rows_with_candidates integer := 0;
begin
  v_result := public.commerce_reconcile_import_batch_v2(p_batch_id);

  -- A duplicate SKU in the same workbook is deliberately kept as a conflict,
  -- but the operator still needs candidate products to decide which row is the
  -- valid representation. V1 stopped before generating those candidates,
  -- leaving the UI with only the option to ignore the row.
  for v_row in
    select id, normalized_payload
    from public.commerce_import_rows
    where batch_id = p_batch_id
      and status = 'CONFLICT'
      and error_code = 'duplicate_sku_in_batch'
    order by id
  loop
    v_primary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_primary', '')), '');
    v_secondary := nullif(btrim(coalesce(v_row.normalized_payload->>'sku_secondary', '')), '');
    v_name := nullif(btrim(coalesce(v_row.normalized_payload->>'product_name', '')), '');
    v_category := nullif(btrim(coalesce(v_row.normalized_payload->>'category', '')), '');

    delete from public.commerce_reconciliation_candidates
    where import_row_id = v_row.id;

    with candidates as (
      select s.product_id, 'SKU_EXACT'::text as method, 1.00000::numeric(6,5) as score
      from public.commerce_product_skus s
      where s.is_active = true
        and upper(btrim(s.sku)) in (upper(v_primary), upper(coalesce(v_secondary, v_primary)))

      union all

      select lp.product_id, 'PLATFORM_SKU_EXACT'::text, 0.99000::numeric(6,5)
      from public.commerce_listing_products lp
      where lp.platform_sku is not null
        and upper(btrim(lp.platform_sku)) in (upper(v_primary), upper(coalesce(v_secondary, v_primary)))

      union all

      select p.id,
        case
          when public.commerce_match_key_v1(c.name) = public.commerce_match_key_v1(v_category)
            then 'NAME_CATEGORY_EXACT'
          else 'NAME_EXACT'
        end,
        case
          when public.commerce_match_key_v1(c.name) = public.commerce_match_key_v1(v_category)
            then 0.95000::numeric(6,5)
          else 0.92000::numeric(6,5)
        end
      from public.commerce_products p
      left join public.commerce_categories c on c.id = p.category_id
      where public.commerce_match_key_v1(p.name) = public.commerce_match_key_v1(v_name)

      union all

      select p.id, 'NAME_YEARLESS_EXACT'::text, 0.88000::numeric(6,5)
      from public.commerce_products p
      where public.commerce_yearless_match_key_v1(v_name) is not null
        and public.commerce_yearless_match_key_v1(p.name) = public.commerce_yearless_match_key_v1(v_name)
        and public.commerce_match_key_v1(p.name) <> public.commerce_match_key_v1(v_name)
    ), best as (
      select distinct on (product_id) product_id, method, score
      from candidates
      order by product_id, score desc, method
    ), ranked as (
      select product_id, method, score,
        row_number() over (order by score desc, product_id)::integer as rank
      from best
    )
    insert into public.commerce_reconciliation_candidates (
      import_row_id, product_id, match_method, match_score, rank
    )
    select v_row.id, product_id, method, score, rank
    from ranked
    order by rank;

    if exists (
      select 1 from public.commerce_reconciliation_candidates
      where import_row_id = v_row.id
    ) then
      v_rows_with_candidates := v_rows_with_candidates + 1;
    end if;
  end loop;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object(
    'duplicate_conflicts_with_candidates', v_rows_with_candidates
  );
end;
$$;

revoke all on function public.commerce_reconcile_import_batch_v3(bigint) from public, anon, authenticated;
grant execute on function public.commerce_reconcile_import_batch_v3(bigint) to service_role;

commit;
