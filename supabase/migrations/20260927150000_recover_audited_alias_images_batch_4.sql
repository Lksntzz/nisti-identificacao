-- Recover two additional Product Master images from audited historical aliases.
--
-- #474 PLANPROF01:
--   Product title is "Agenda Planner Do Professor Para Planejamento Escolar Rosa Feliz".
--   Historical source row #2249 is linked to current Product Master #42 and keeps
--   the same "Rosa Feliz" title. Shopee snapshot listing #42 supplies the image
--   for SKU PNJPRO FLZ BB.
--
-- #550 AGMT26_MAN02_PBB:
--   Product title identifies the black cover. Historical source row #2253 is
--   linked to current Product Master #36 and explicitly says "Cor da capa preta".
--   Both Product Masters are 2026 identities; Shopee snapshot listing #36
--   supplies the audited image.
--
-- No SKU is rewritten. These are card-level reference images only.

do $assert_sources$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=474
      and s.sku='PLANPROF01'
      and lower(p.name) like '%rosa feliz%'
  ) then
    raise exception 'Expected live PLANPROF01 Rosa Feliz Product Master not found';
  end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.id=2249
      and sr.matched_product_id=42
      and lower(coalesce(sr.normalized_payload->>'product_name','')) like '%rosa feliz%'
  ) then
    raise exception 'Expected Rosa Feliz historical source row not found';
  end if;

  if not exists (
    select 1
    from public.commerce_marketplace_snapshots s
    where s.listing_id=42
      and s.match_status='MATCHED'
      and s.parent_sku='PNJPRO FLZ BB'
      and s.cover_image_url='https://cf.shopee.com.br/file/br-11134207-7r98r-lm0zlks473fv03'
  ) then
    raise exception 'Expected Rosa Feliz Shopee snapshot not found';
  end if;

  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=550
      and s.sku='AGMT26_MAN02_PBB'
      and p.edition_year=2026
      and lower(p.name) like '%capa preta%'
  ) then
    raise exception 'Expected live AGMT26_MAN02_PBB Product Master not found';
  end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.id=2253
      and sr.matched_product_id=36
      and lower(coalesce(sr.normalized_payload->>'product_name','')) like '%capa preta%'
  ) then
    raise exception 'Expected black-cover historical source row not found';
  end if;

  if not exists (
    select 1
    from public.commerce_marketplace_snapshots s
    where s.listing_id=36
      and s.match_status='MATCHED'
      and s.cover_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m210vvin4p2c32'
  ) then
    raise exception 'Expected black-cover Shopee snapshot not found';
  end if;
end
$assert_sources$;

with mappings(product_id,source_kind,reference_sku,image_url) as (
  values
    (474::bigint,'PLATFORM_AUDITED_ALIAS','PNJPRO FLZ BB','https://cf.shopee.com.br/file/br-11134207-7r98r-lm0zlks473fv03'),
    (550::bigint,'PLATFORM_AUDITED_ALIAS','AGMT26_MAN25','https://cf.shopee.com.br/file/br-11134207-7r98o-m210vvin4p2c32')
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
    (550::bigint,'PLATFORM_AUDITED_ALIAS','AGMT26_MAN25','https://cf.shopee.com.br/file/br-11134207-7r98o-m210vvin4p2c32')
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
    where id in (474,550)
      and reference_image_source='PLATFORM_AUDITED_ALIAS'
      and reference_image_url is not null
  ) <> 2 then
    raise exception 'Expected two live batch-4 image recoveries';
  end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where id in (474,550)
      and reference_image_source='PLATFORM_AUDITED_ALIAS'
      and reference_image_url is not null
  ) <> 2 then
    raise exception 'Expected two preview batch-4 image recoveries';
  end if;
end
$assert_result$;
