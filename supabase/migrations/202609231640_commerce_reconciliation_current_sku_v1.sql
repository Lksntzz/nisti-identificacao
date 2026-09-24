do $$
declare
  v_oid oid;
  v_def text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='commerce_preview_resolve_reconciliation_listing_v1'
    and pg_get_function_identity_arguments(p.oid)='p_listing_id bigint, p_action text, p_product_id bigint, p_product_name text, p_category_id bigint, p_platform_skus text[], p_apply_family boolean, p_resolve boolean, p_operator text';

  v_def := pg_get_functiondef(v_oid);
  v_def := replace(
    v_def,
    '    v_product_id := v_created_product_id;' || chr(10) || '  end if;',
    '    v_product_id := v_created_product_id;' || chr(10) ||
    chr(10) ||
    '    if p_platform_skus is not null and cardinality(p_platform_skus)=1 then' || chr(10) ||
    '      insert into public.commerce_preview_product_skus(product_id,sku,sku_type,is_active)' || chr(10) ||
    '      select v_product_id,btrim(p_platform_skus[1]),''CURRENT'',true' || chr(10) ||
    '      where nullif(btrim(p_platform_skus[1]),'''') is not null' || chr(10) ||
    '        and not exists (' || chr(10) ||
    '          select 1 from public.commerce_preview_product_skus ps' || chr(10) ||
    '          where upper(btrim(ps.sku))=upper(btrim(p_platform_skus[1]))' || chr(10) ||
    '        );' || chr(10) ||
    '    end if;' || chr(10) ||
    '  end if;'
  );
  execute v_def;

  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='commerce_resolve_reconciliation_listing_v1'
    and pg_get_function_identity_arguments(p.oid)='p_listing_id bigint, p_action text, p_product_id bigint, p_product_name text, p_category_id bigint, p_platform_skus text[], p_apply_family boolean, p_resolve boolean, p_operator text';

  v_def := pg_get_functiondef(v_oid);
  v_def := replace(
    v_def,
    '    v_product_id := v_created_product_id;' || chr(10) || '  end if;',
    '    v_product_id := v_created_product_id;' || chr(10) ||
    chr(10) ||
    '    if p_platform_skus is not null and cardinality(p_platform_skus)=1 then' || chr(10) ||
    '      insert into public.commerce_product_skus(product_id,sku,sku_type,is_active)' || chr(10) ||
    '      select v_product_id,btrim(p_platform_skus[1]),''CURRENT'',true' || chr(10) ||
    '      where nullif(btrim(p_platform_skus[1]),'''') is not null' || chr(10) ||
    '        and not exists (' || chr(10) ||
    '          select 1 from public.commerce_product_skus ps' || chr(10) ||
    '          where upper(btrim(ps.sku))=upper(btrim(p_platform_skus[1]))' || chr(10) ||
    '        );' || chr(10) ||
    '    end if;' || chr(10) ||
    '  end if;'
  );
  execute v_def;
end
$$;
