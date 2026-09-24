create or replace function public.commerce_preview_catalog_audit_v2()
returns table(check_name text,severity text,violations bigint,details jsonb)
language sql
stable
security invoker
set search_path=public
as $$
  select * from public.commerce_preview_catalog_audit_v1()
  union all
  select 'product_multiple_sku_rows','BLOCKER',count(*)::bigint,
    jsonb_build_object('description','Produto Mestre com mais de um SKU; regra vigente exige 1 SKU → 1 Produto Mestre')
  from (select product_id from public.commerce_preview_product_skus group by product_id having count(*)>1) q
  union all
  select 'product_multiple_listing_skus','BLOCKER',count(*)::bigint,
    jsonb_build_object('description','Produto Mestre vinculado a mais de um SKU distinto nos anúncios')
  from (
    select product_id from public.commerce_preview_listing_products
    where nullif(btrim(platform_sku),'') is not null
    group by product_id having count(distinct upper(btrim(platform_sku)))>1
  ) q
  union all
  select 'listing_sku_owner_mismatch','BLOCKER',count(*)::bigint,
    jsonb_build_object('description','SKU do anúncio não coincide com o SKU CURRENT do Produto Mestre vinculado')
  from public.commerce_preview_listing_products lp
  left join public.commerce_preview_product_skus ps
    on ps.product_id=lp.product_id and ps.sku_type='CURRENT' and ps.is_active
  where nullif(btrim(lp.platform_sku),'') is not null
    and (ps.id is null or upper(btrim(ps.sku))<>upper(btrim(lp.platform_sku)));
$$;

revoke all on function public.commerce_preview_catalog_audit_v2() from public,anon,authenticated;
grant execute on function public.commerce_preview_catalog_audit_v2() to service_role;

create or replace function public.commerce_catalog_audit_v2()
returns table(check_name text,severity text,violations bigint,details jsonb)
language sql
stable
security invoker
set search_path=public
as $$
  select * from public.commerce_catalog_audit_v1()
  union all
  select 'product_multiple_sku_rows','BLOCKER',count(*)::bigint,
    jsonb_build_object('description','Produto Mestre com mais de um SKU; regra vigente exige 1 SKU → 1 Produto Mestre')
  from (select product_id from public.commerce_product_skus group by product_id having count(*)>1) q
  union all
  select 'product_multiple_listing_skus','BLOCKER',count(*)::bigint,
    jsonb_build_object('description','Produto Mestre vinculado a mais de um SKU distinto nos anúncios')
  from (
    select product_id from public.commerce_listing_products
    where nullif(btrim(platform_sku),'') is not null
    group by product_id having count(distinct upper(btrim(platform_sku)))>1
  ) q
  union all
  select 'listing_sku_owner_mismatch','BLOCKER',count(*)::bigint,
    jsonb_build_object('description','SKU do anúncio não coincide com o SKU CURRENT do Produto Mestre vinculado')
  from public.commerce_listing_products lp
  left join public.commerce_product_skus ps
    on ps.product_id=lp.product_id and ps.sku_type='CURRENT' and ps.is_active
  where nullif(btrim(lp.platform_sku),'') is not null
    and (ps.id is null or upper(btrim(ps.sku))<>upper(btrim(lp.platform_sku)));
$$;

revoke all on function public.commerce_catalog_audit_v2() from public,anon,authenticated;
grant execute on function public.commerce_catalog_audit_v2() to service_role;
