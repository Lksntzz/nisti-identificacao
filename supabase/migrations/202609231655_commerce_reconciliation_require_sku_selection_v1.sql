do $$
declare
  v_oid oid;
  v_def text;
  v_names text[] := array[
    'commerce_preview_resolve_reconciliation_listing_v1',
    'commerce_resolve_reconciliation_listing_v1'
  ];
  v_name text;
begin
  foreach v_name in array v_names loop
    select p.oid into v_oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname=v_name
      and pg_get_function_identity_arguments(p.oid)=
        'p_listing_id bigint, p_action text, p_product_id bigint, p_product_name text, p_category_id bigint, p_platform_skus text[], p_apply_family boolean, p_resolve boolean, p_operator text';

    v_def := pg_get_functiondef(v_oid);

    v_def := replace(
      v_def,
      '  if coalesce(p_apply_family,false) and v_family is null then' || chr(10) ||
      '    raise exception ''reconciliation_family_missing'' using errcode=''22023'';' || chr(10) ||
      '  end if;',
      '  if coalesce(p_apply_family,false) and v_family is null then' || chr(10) ||
      '    raise exception ''reconciliation_family_missing'' using errcode=''22023'';' || chr(10) ||
      '  end if;' || chr(10) ||
      chr(10) ||
      '  if v_action in (''LINK_EXISTING'',''CREATE_NEW'')' || chr(10) ||
      '     and p_platform_skus is not null' || chr(10) ||
      '     and cardinality(p_platform_skus)=0 then' || chr(10) ||
      '    raise exception ''sku_selection_required'' using errcode=''22023'';' || chr(10) ||
      '  end if;'
    );

    v_def := replace(
      v_def,
      'p_platform_skus is null' || chr(10) ||
      '          or cardinality(p_platform_skus)=0' || chr(10) ||
      '          or sr.normalized_payload->>''sku''=any(p_platform_skus)',
      'p_platform_skus is null' || chr(10) ||
      '          or sr.normalized_payload->>''sku''=any(p_platform_skus)'
    );

    execute v_def;
  end loop;
end
$$;
