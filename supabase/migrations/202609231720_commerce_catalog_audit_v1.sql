create or replace function public.commerce_preview_catalog_audit_v1()
returns table(check_name text,severity text,violations bigint,details jsonb)
language sql
stable
security invoker
set search_path=public
as $$
  select 'pending_reconciliation','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Anúncios ainda aguardando decisão manual')
  from public.commerce_preview_listings
  where coalesce((raw_metadata->>'product_reconciliation_pending')::boolean,false)=true

  union all
  select 'duplicate_normalized_sku','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','SKUs normalizados atribuídos a mais de um Produto Mestre')
  from (
    select upper(btrim(sku))
    from public.commerce_preview_product_skus
    group by upper(btrim(sku))
    having count(*)>1
  ) q

  union all
  select 'products_without_current_sku','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Produtos Mestre sem um SKU CURRENT ativo')
  from (
    select p.id
    from public.commerce_preview_products p
    left join public.commerce_preview_product_skus ps
      on ps.product_id=p.id and ps.sku_type='CURRENT' and ps.is_active
    group by p.id
    having count(ps.id)<>1
  ) q

  union all
  select 'duplicate_exact_listing_product_link','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Vínculos produto/anúncio/SKU/variação duplicados')
  from (
    select listing_id,product_id,coalesce(platform_sku,''),coalesce(variation_name,'')
    from public.commerce_preview_listing_products
    group by listing_id,product_id,coalesce(platform_sku,''),coalesce(variation_name,'')
    having count(*)>1
  ) q

  union all
  select 'same_listing_sku_multiple_products','REVIEW',
    count(*)::bigint,
    jsonb_build_object('description','Mesmo SKU de um anúncio vinculado a mais de um Produto Mestre')
  from (
    select listing_id,upper(btrim(platform_sku))
    from public.commerce_preview_listing_products
    where nullif(btrim(platform_sku),'') is not null
    group by listing_id,upper(btrim(platform_sku))
    having count(distinct product_id)>1
  ) q

  union all
  select 'orphan_listings','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Anúncios sem nenhum Produto Mestre vinculado')
  from public.commerce_preview_listings l
  where not exists (
    select 1 from public.commerce_preview_listing_products lp where lp.listing_id=l.id
  )

  union all
  select 'duplicate_normalized_product_name','REVIEW',
    count(*)::bigint,
    jsonb_build_object('description','Nomes idênticos em Produtos Mestre diferentes')
  from (
    select lower(btrim(name))
    from public.commerce_preview_products
    group by lower(btrim(name))
    having count(*)>1
  ) q

  union all
  select 'source_variant_without_listing_link','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','SKU/variação existente no snapshot da planilha mas ausente dos vínculos do anúncio')
  from (
    select distinct sr.id
    from public.commerce_preview_source_rows sr
    join public.commerce_preview_listings l
      on nullif(btrim(sr.normalized_payload->>'listing_url'),'')=l.canonical_url
    where nullif(btrim(sr.normalized_payload->>'sku'),'') is not null
      and not exists (
        select 1
        from public.commerce_preview_listing_products lp
        where lp.listing_id=l.id
          and upper(btrim(coalesce(lp.platform_sku,'')))=upper(btrim(sr.normalized_payload->>'sku'))
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(l.raw_metadata->'operator_correction'->'source_skus')='array'
               then l.raw_metadata->'operator_correction'->'source_skus'
               else '[]'::jsonb end
        ) accepted(sku)
        where upper(btrim(accepted.sku))=upper(btrim(sr.normalized_payload->>'sku'))
      )
  ) q

  union all
  select 'unknown_relation_status','WARN',
    count(*)::bigint,
    jsonb_build_object('description','Vínculos importados ainda com relation_status UNKNOWN')
  from public.commerce_preview_listing_products
  where relation_status='UNKNOWN'

  union all
  select 'suspicious_sku_prefix','REVIEW',
    count(*)::bigint,
    jsonb_build_object('description','SKU com prefixo VCMNO_ em família que normalmente usa VACMNO_')
  from public.commerce_preview_product_skus
  where sku ~ '^VCMNO_';
$$;

revoke all on function public.commerce_preview_catalog_audit_v1() from public,anon,authenticated;
grant execute on function public.commerce_preview_catalog_audit_v1() to service_role;

create or replace function public.commerce_catalog_audit_v1()
returns table(check_name text,severity text,violations bigint,details jsonb)
language sql
stable
security invoker
set search_path=public
as $$
  select 'pending_reconciliation','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Anúncios ainda aguardando decisão manual')
  from public.commerce_listings
  where coalesce((raw_metadata->>'product_reconciliation_pending')::boolean,false)=true

  union all
  select 'duplicate_normalized_sku','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','SKUs normalizados atribuídos a mais de um Produto Mestre')
  from (
    select upper(btrim(sku))
    from public.commerce_product_skus
    group by upper(btrim(sku))
    having count(*)>1
  ) q

  union all
  select 'products_without_current_sku','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Produtos Mestre sem um SKU CURRENT ativo')
  from (
    select p.id
    from public.commerce_products p
    left join public.commerce_product_skus ps
      on ps.product_id=p.id and ps.sku_type='CURRENT' and ps.is_active
    group by p.id
    having count(ps.id)<>1
  ) q

  union all
  select 'duplicate_exact_listing_product_link','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Vínculos produto/anúncio/SKU/variação duplicados')
  from (
    select listing_id,product_id,coalesce(platform_sku,''),coalesce(variation_name,'')
    from public.commerce_listing_products
    group by listing_id,product_id,coalesce(platform_sku,''),coalesce(variation_name,'')
    having count(*)>1
  ) q

  union all
  select 'same_listing_sku_multiple_products','REVIEW',
    count(*)::bigint,
    jsonb_build_object('description','Mesmo SKU de um anúncio vinculado a mais de um Produto Mestre')
  from (
    select listing_id,upper(btrim(platform_sku))
    from public.commerce_listing_products
    where nullif(btrim(platform_sku),'') is not null
    group by listing_id,upper(btrim(platform_sku))
    having count(distinct product_id)>1
  ) q

  union all
  select 'orphan_listings','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','Anúncios sem nenhum Produto Mestre vinculado')
  from public.commerce_listings l
  where not exists (
    select 1 from public.commerce_listing_products lp where lp.listing_id=l.id
  )

  union all
  select 'duplicate_normalized_product_name','REVIEW',
    count(*)::bigint,
    jsonb_build_object('description','Nomes idênticos em Produtos Mestre diferentes')
  from (
    select lower(btrim(name))
    from public.commerce_products
    group by lower(btrim(name))
    having count(*)>1
  ) q

  union all
  select 'source_variant_without_listing_link','BLOCKER',
    count(*)::bigint,
    jsonb_build_object('description','SKU/variação existente no snapshot da planilha mas ausente dos vínculos do anúncio')
  from (
    select distinct sr.id
    from public.commerce_source_rows sr
    join public.commerce_listings l
      on nullif(btrim(sr.normalized_payload->>'listing_url'),'')=l.canonical_url
    where nullif(btrim(sr.normalized_payload->>'sku'),'') is not null
      and not exists (
        select 1
        from public.commerce_listing_products lp
        where lp.listing_id=l.id
          and upper(btrim(coalesce(lp.platform_sku,'')))=upper(btrim(sr.normalized_payload->>'sku'))
      )
      and not exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(l.raw_metadata->'operator_correction'->'source_skus')='array'
               then l.raw_metadata->'operator_correction'->'source_skus'
               else '[]'::jsonb end
        ) accepted(sku)
        where upper(btrim(accepted.sku))=upper(btrim(sr.normalized_payload->>'sku'))
      )
  ) q

  union all
  select 'unknown_relation_status','WARN',
    count(*)::bigint,
    jsonb_build_object('description','Vínculos importados ainda com relation_status UNKNOWN')
  from public.commerce_listing_products
  where relation_status='UNKNOWN'

  union all
  select 'suspicious_sku_prefix','REVIEW',
    count(*)::bigint,
    jsonb_build_object('description','SKU com prefixo VCMNO_ em família que normalmente usa VACMNO_')
  from public.commerce_product_skus
  where sku ~ '^VCMNO_';
$$;

revoke all on function public.commerce_catalog_audit_v1() from public,anon,authenticated;
grant execute on function public.commerce_catalog_audit_v1() to service_role;
