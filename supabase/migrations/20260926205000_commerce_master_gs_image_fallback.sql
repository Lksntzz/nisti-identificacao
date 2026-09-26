-- Recover a Product Master image from GS only when:
-- 1) the platform-derived card still has no image;
-- 2) GS has the same structured family + cover signature as the current Master SKU;
-- 3) artwork year is compatible;
-- 4) that signature resolves to exactly one distinct GS image.
--
-- This intentionally runs only at the Product Master card level. It must not
-- backfill marketplace rows from historical platform SKUs, which could mix
-- artwork years (for example 2024/2025 listings into a 2026 Product Master).

do $patch$
declare
  fn_name text;
  source_rows_table text;
  fn_oid oid;
  def text;
  patched text;
  old_fragment text := $old$
    (
      select item->>'image_url'
      from jsonb_array_elements(lb.platforms) p
      cross join lateral jsonb_array_elements(p->'items') item
      where nullif(item->>'image_url','') is not null
      order by case when (item->>'edition_year') ~ '^[0-9]+$' and (item->>'edition_year')::integer=lb.edition_year then 0 else 1 end,
               case p->>'source_code' when 'SHOPEE' then 1 when 'ML_NOVO' then 2 when 'ML_ANTIGO' then 3 when 'AMAZON' then 4 when 'SHEIN' then 5 else 9 end
      limit 1
    ) as image_url,
$old$;
  new_fragment_template text := $new$
    coalesce(
      (
        select item->>'image_url'
        from jsonb_array_elements(lb.platforms) p
        cross join lateral jsonb_array_elements(p->'items') item
        where nullif(item->>'image_url','') is not null
        order by case when (item->>'edition_year') ~ '^[0-9]+$' and (item->>'edition_year')::integer=lb.edition_year then 0 else 1 end,
                 case p->>'source_code' when 'SHOPEE' then 1 when 'ML_NOVO' then 2 when 'ML_ANTIGO' then 3 when 'AMAZON' then 4 when 'SHEIN' then 5 else 9 end
        limit 1
      ),
      (
        select min(nullif(g.normalized_payload->>'image_url',''))
        from gs_file f
        join public.__SOURCE_ROWS__ g
          on g.source_file_id=f.id and g.is_header=false
        where nullif(g.normalized_payload->>'image_url','') is not null
          and nullif(public.commerce_sku_pattern_v1(lb.master_sku)->>'signature','') is not null
          and public.commerce_sku_pattern_v1(g.normalized_payload->>'sku')->>'signature'
              = public.commerce_sku_pattern_v1(lb.master_sku)->>'signature'
          and public.commerce_image_years_compatible(
            lb.master_sku,
            g.normalized_payload->>'sku',
            g.normalized_payload->>'product_name'
          )
        having count(distinct nullif(g.normalized_payload->>'image_url',''))=1
      )
    ) as image_url,
$new$;
  new_marker text := 'having count(distinct nullif(g.normalized_payload->>''image_url'',''''))=1';
  new_fragment text;
begin
  foreach fn_name in array array[
    'commerce_management_products_v2',
    'commerce_preview_management_products_v2'
  ]
  loop
    source_rows_table := case
      when fn_name like 'commerce_preview_%' then 'commerce_preview_source_rows'
      else 'commerce_source_rows'
    end;

    select p.oid into fn_oid
    from pg_proc p
    where p.pronamespace='public'::regnamespace
      and p.proname=fn_name
    limit 1;

    if fn_oid is null then
      raise exception 'Function % not found',fn_name;
    end if;

    def := pg_get_functiondef(fn_oid);

    if position(new_marker in def)>0 then
      continue;
    end if;

    if position(old_fragment in def)=0 then
      raise exception 'Expected linked-card image fragment not found in %',fn_name;
    end if;

    new_fragment := replace(
      new_fragment_template,
      '__SOURCE_ROWS__',
      source_rows_table
    );

    patched := replace(def,old_fragment,new_fragment);
    execute patched;
  end loop;
end
$patch$;
