create or replace function public.commerce_preview_enforce_sku_product_identity_v2(
  p_operator text default 'SMITH'
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_result jsonb;
  v_residual_created integer := 0;
  rec record;
  v_new_product_id bigint;
begin
  v_result := public.commerce_preview_enforce_sku_product_identity_v1(p_operator);

  for rec in
    select
      ps.id as sku_id,
      ps.product_id as old_product_id,
      ps.sku,
      p.name,
      p.category_id,
      p.subcategory_id,
      p.temporal_type,
      p.edition_year
    from public.commerce_preview_product_skus ps
    join public.commerce_preview_products p on p.id=ps.product_id
    where not (ps.sku_type='CURRENT' and ps.is_active)
    order by ps.id
  loop
    insert into public.commerce_preview_products(
      name,category_id,subcategory_id,temporal_type,edition_year,internal_status,notes
    )
    values(
      rec.name||' - SKU '||rec.sku,
      rec.category_id,rec.subcategory_id,rec.temporal_type,rec.edition_year,'DRAFT',
      'Separado automaticamente pela regra global SKU → Produto Mestre. SKU legado/alias convertido em Produto Mestre próprio; origem Produto Mestre #'||
      rec.old_product_id||'; operador='||coalesce(p_operator,'')
    )
    returning id into v_new_product_id;

    update public.commerce_preview_product_skus
    set product_id=v_new_product_id,
        sku_type='CURRENT',
        is_active=true,
        updated_at=now()
    where id=rec.sku_id;

    v_residual_created := v_residual_created + 1;
  end loop;

  return v_result || jsonb_build_object(
    'residual_alias_products_created',v_residual_created,
    'fully_enforced',true
  );
end;
$$;

revoke all on function public.commerce_preview_enforce_sku_product_identity_v2(text) from public,anon,authenticated;
grant execute on function public.commerce_preview_enforce_sku_product_identity_v2(text) to service_role;
