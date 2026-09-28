-- Recover four Product Master images from audited component/product aliases.
--
-- User requirement: duplicate an existing product photo when identity is known;
-- artwork freshness does not need to match.
--
-- 410 CMB_VACMNA_LILAS_BXB:
--     kit cover explicitly contains VACMNA_LILAS; image catalog has VACMNA_LILAS_BBB.
-- 652 MANI25_PROFSS_BXB:
--     legacy title "Agenda Manicure - Agendamentos Com Forma De Pagamento"
--     maps to current permanent SKU AGP2112/AGMAPERM01, same catalog image.
-- 706 PNJPRO CMB24:
--     combo title explicitly identifies Professor Coruja; reuse PNJPRO_CORU_BAA.
-- 714 CMBDEV365_PTDHRZ:
--     kit title explicitly includes "Meu Tempo com Deus"; cover component PTDHRZ
--     maps to PTDHRZ_MTD_BXB.

do $assert$
begin
  if (select count(*) from public.commerce_product_skus
      where (product_id=410 and sku='CMB_VACMNA_LILAS_BXB')
         or (product_id=652 and sku='MANI25_PROFSS_BXB')
         or (product_id=706 and sku='PNJPRO CMB24')
         or (product_id=714 and sku='CMBDEV365_PTDHRZ')
  ) <> 4 then
    raise exception 'Expected four target Product Master SKUs';
  end if;

  if not exists (
    select 1 from public.commerce_source_rows
    where matched_product_id=652
      and lower(coalesce(normalized_payload->>'product_name',''))
          like '%agenda manicure%agendamentos%forma de pagamento%'
  ) then raise exception 'Manicure alias evidence missing'; end if;
end
$assert$;

with mappings(product_id,reference_sku,url,source) as (
  values
    (
      410::bigint,
      'VACMNA_LILAS_BBB'::text,
      'https://cf.shopee.com.br/file/sg-11134201-824ip-me4leuxzvlz687'::text,
      'COMPONENT_ALIAS'::text
    ),
    (
      652::bigint,
      'AGP2112'::text,
      'https://cf.shopee.com.br/file/br-11134207-7r98o-m8ovnaxe2eflee'::text,
      'PLATFORM_AUDITED_ALIAS'::text
    ),
    (
      706::bigint,
      'PNJPRO_CORU_BAA'::text,
      'https://cf.shopee.com.br/file/br-11134207-7r98o-m8w9nehfml2x44'::text,
      'COMPONENT_ALIAS'::text
    ),
    (
      714::bigint,
      'PTDHRZ_MTD_BXB'::text,
      'https://cf.shopee.com.br/file/sg-11134201-7rdyb-md61dnfau3mucf'::text,
      'COMPONENT_ALIAS'::text
    )
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source=m.source,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

with mappings(product_id,reference_sku,url,source) as (
  values
    (
      410::bigint,
      'VACMNA_LILAS_BBB'::text,
      'https://cf.shopee.com.br/file/sg-11134201-824ip-me4leuxzvlz687'::text,
      'COMPONENT_ALIAS'::text
    ),
    (
      652::bigint,
      'AGP2112'::text,
      'https://cf.shopee.com.br/file/br-11134207-7r98o-m8ovnaxe2eflee'::text,
      'PLATFORM_AUDITED_ALIAS'::text
    ),
    (
      706::bigint,
      'PNJPRO_CORU_BAA'::text,
      'https://cf.shopee.com.br/file/br-11134207-7r98o-m8w9nehfml2x44'::text,
      'COMPONENT_ALIAS'::text
    ),
    (
      714::bigint,
      'PTDHRZ_MTD_BXB'::text,
      'https://cf.shopee.com.br/file/sg-11134201-7rdyb-md61dnfau3mucf'::text,
      'COMPONENT_ALIAS'::text
    )
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source=m.source,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

do $verify$
begin
  if (select count(*) from public.commerce_products
      where id in (410,652,706,714)
        and reference_image_url is not null) <> 4 then
    raise exception 'Expected four live component/alias image recoveries';
  end if;

  if (select count(*) from public.commerce_preview_products
      where id in (410,652,706,714)
        and reference_image_url is not null) <> 4 then
    raise exception 'Expected four preview component/alias image recoveries';
  end if;
end
$verify$;
