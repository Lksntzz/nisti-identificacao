-- Recover five additional Product Master images from audited historical aliases.
--
-- All mappings below were confirmed by exact historical identity evidence:
-- a historical source row points to an already-imaged Product Master and the
-- target Product Master preserves the same product/listing identity.
--
-- #474 PLANPROF01 -> PNJPRO FLZ BB (Rosa Feliz)
-- #550 AGMT26_MAN02_PBB -> AGMT26_MAN25 (Manicure/Pedicure, capa preta, 2026)
-- #492 RECTAS_MNA_BXB -> CADRMR01 (same Mercado Livre listing MLB5365826226)
-- #519 VACMNAP FLO BRR -> CADMNAPFL (Floral/Rosa historical identity)
-- #520 VACMNO NVP BAA -> VACMNOP NUV BAA (same Mercado Livre listing MLB4657828106)
--
-- No SKU is rewritten. These are card-level reference images only.
-- The 2026 PB_EXEC alias is intentionally excluded because its only available
-- image is a 2027 artwork.

do $assert_sources$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=474
      and s.sku='PLANPROF01'
      and lower(p.name) like '%rosa feliz%'
  ) then raise exception 'Expected PLANPROF01 Rosa Feliz target not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.id=2249
      and sr.matched_product_id=42
      and lower(coalesce(sr.normalized_payload->>'product_name','')) like '%rosa feliz%'
  ) then raise exception 'Expected Rosa Feliz historical source row not found'; end if;

  if not exists (
    select 1
    from public.commerce_marketplace_snapshots s
    where s.listing_id=42
      and s.match_status='MATCHED'
      and s.parent_sku='PNJPRO FLZ BB'
      and s.cover_image_url='https://cf.shopee.com.br/file/br-11134207-7r98r-lm0zlks473fv03'
  ) then raise exception 'Expected Rosa Feliz Shopee snapshot not found'; end if;

  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=550
      and s.sku='AGMT26_MAN02_PBB'
      and p.edition_year=2026
      and lower(p.name) like '%capa preta%'
  ) then raise exception 'Expected AGMT26_MAN02_PBB target not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.id=2253
      and sr.matched_product_id=36
      and lower(coalesce(sr.normalized_payload->>'product_name','')) like '%capa preta%'
  ) then raise exception 'Expected black-cover historical source row not found'; end if;

  if not exists (
    select 1
    from public.commerce_marketplace_snapshots s
    where s.listing_id=36
      and s.match_status='MATCHED'
      and s.cover_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m210vvin4p2c32'
  ) then raise exception 'Expected black-cover Shopee snapshot not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.id=2358
      and sr.matched_product_id=176
      and sr.normalized_payload->>'sku_base'='RECTAS_MNA_BXB'
      and sr.normalized_payload->>'listing_url'
          ='https://produto.mercadolivre.com.br/MLB-5365826226-caderno-de-receitas-com-capa-dura-coleco-minhas-receitas-_JM'
  ) then raise exception 'Expected Minhas Receitas historical listing identity not found'; end if;

  if not exists (
    select 1
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    where lp.product_id=492
      and l.external_listing_id='MLB5365826226'
  ) then raise exception 'Expected RECTAS_MNA_BXB target listing not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.id=2406
      and sr.matched_product_id=235
      and sr.normalized_payload->>'sku_base'='VACMNAP FLO BRR'
      and lower(coalesce(sr.normalized_payload->>'product_name','')) like '%vacinação menina%capa dura%rosa%'
  ) then raise exception 'Expected Floral/Rosa historical source row not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.id=470
      and sr.matched_product_id=234
      and lower(coalesce(sr.normalized_payload->>'product_name','')) like '%vacinação menino%capa dura%atualizada%'
  ) then raise exception 'Expected Nuvem historical source row not found'; end if;

  if not exists (
    select 1
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    where lp.product_id=520
      and l.external_listing_id='MLB4657828106'
  ) then raise exception 'Expected VACMNO NVP BAA target listing not found'; end if;
end
$assert_sources$;

with mappings(product_id,source_kind,reference_sku,image_url) as (
  values
    (474::bigint,'PLATFORM_AUDITED_ALIAS','PNJPRO FLZ BB','https://cf.shopee.com.br/file/br-11134207-7r98r-lm0zlks473fv03'),
    (550::bigint,'PLATFORM_AUDITED_ALIAS','AGMT26_MAN25','https://cf.shopee.com.br/file/br-11134207-7r98o-m210vvin4p2c32'),
    (492::bigint,'PLATFORM_EXACT_LISTING','CADRMR01','https://cf.shopee.com.br/file/br-11134207-7r98o-m8owbt8opm9uf8'),
    (519::bigint,'PLATFORM_AUDITED_ALIAS','CADMNAPFL','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w09i6qd9tub3'),
    (520::bigint,'PLATFORM_EXACT_LISTING','VACMNOP NUV BAA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c')
)
update public.commerce_products p
set reference_image_url=m.image_url,
    reference_image_source=m.source_kind,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source=m.source_kind
  );

with mappings(product_id,source_kind,reference_sku,image_url) as (
  values
    (474::bigint,'PLATFORM_AUDITED_ALIAS','PNJPRO FLZ BB','https://cf.shopee.com.br/file/br-11134207-7r98r-lm0zlks473fv03'),
    (550::bigint,'PLATFORM_AUDITED_ALIAS','AGMT26_MAN25','https://cf.shopee.com.br/file/br-11134207-7r98o-m210vvin4p2c32'),
    (492::bigint,'PLATFORM_EXACT_LISTING','CADRMR01','https://cf.shopee.com.br/file/br-11134207-7r98o-m8owbt8opm9uf8'),
    (519::bigint,'PLATFORM_AUDITED_ALIAS','CADMNAPFL','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w09i6qd9tub3'),
    (520::bigint,'PLATFORM_EXACT_LISTING','VACMNOP NUV BAA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c')
)
update public.commerce_preview_products p
set reference_image_url=m.image_url,
    reference_image_source=m.source_kind,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source=m.source_kind
  );

do $assert_result$
begin
  if (
    select count(*)
    from public.commerce_products
    where id in (474,492,519,520,550)
      and reference_image_url is not null
  ) <> 5 then
    raise exception 'Expected five live batch-4 image recoveries';
  end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where id in (474,492,519,520,550)
      and reference_image_url is not null
  ) <> 5 then
    raise exception 'Expected five preview batch-4 image recoveries';
  end if;
end
$assert_result$;
