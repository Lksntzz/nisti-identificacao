-- Recover four remaining Product Master images with audited representative sources.
--
-- #305 AGESTETICA01:
-- official Nisti product page cover (year-neutral artwork).
--
-- #712/#713/#717:
-- generic personalized/logo products for 2027. These products do not have a
-- fixed cover, so use the curated 2027 personalized representative artwork
-- PB27_AGPERS_BBB already stored in NistiWork. No SKU is rewritten.

do $assert$
begin
  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=305 and s.sku='AGESTETICA01' and p.edition_year=2025
  ) then
    raise exception 'Expected Product Master #305 AGESTETICA01 not found';
  end if;

  if (
    select count(*)
    from public.commerce_products p
    where p.id in (712,713,717)
      and p.edition_year=2027
      and upper(p.name) like '%PERSONALIZ%'
  ) <> 3 then
    raise exception 'Expected three generic personalized 2027 Product Masters';
  end if;
end
$assert$;

with mappings(product_id,url,source,reference_sku) as (
  values
    (
      305::bigint,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/151763269/agenda_estetica_001-aj0xl3janu.jpg'::text,
      'NISTI_SITE_OFFICIAL'::text,
      'AGDESTC'::text
    ),
    (
      712::bigint,
      'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_AGPERS_BBB.png'::text,
      'NISTIWORK_REPRESENTATIVE'::text,
      'PB27_AGPERS_BBB'::text
    ),
    (
      713::bigint,
      'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_AGPERS_BBB.png'::text,
      'NISTIWORK_REPRESENTATIVE'::text,
      'PB27_AGPERS_BBB'::text
    ),
    (
      717::bigint,
      'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_AGPERS_BBB.png'::text,
      'NISTIWORK_REPRESENTATIVE'::text,
      'PB27_AGPERS_BBB'::text
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

with mappings(product_id,url,source,reference_sku) as (
  values
    (
      305::bigint,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/151763269/agenda_estetica_001-aj0xl3janu.jpg'::text,
      'NISTI_SITE_OFFICIAL'::text,
      'AGDESTC'::text
    ),
    (
      712::bigint,
      'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_AGPERS_BBB.png'::text,
      'NISTIWORK_REPRESENTATIVE'::text,
      'PB27_AGPERS_BBB'::text
    ),
    (
      713::bigint,
      'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_AGPERS_BBB.png'::text,
      'NISTIWORK_REPRESENTATIVE'::text,
      'PB27_AGPERS_BBB'::text
    ),
    (
      717::bigint,
      'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_AGPERS_BBB.png'::text,
      'NISTIWORK_REPRESENTATIVE'::text,
      'PB27_AGPERS_BBB'::text
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
  if (
    select count(*) from public.commerce_products
    where id in (305,712,713,717)
      and reference_image_url is not null
  ) <> 4 then
    raise exception 'Live personalized recovery count mismatch';
  end if;

  if (
    select count(*) from public.commerce_preview_products
    where id in (305,712,713,717)
      and reference_image_url is not null
  ) <> 4 then
    raise exception 'Preview personalized recovery count mismatch';
  end if;
end
$verify$;
