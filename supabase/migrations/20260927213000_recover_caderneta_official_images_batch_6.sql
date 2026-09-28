-- Recover two Product Master images from exact-code pages on the official Nisti site.
--
-- Official Nisti pages:
--   #650 CADVMABL -> Caderneta De Vacinação Menina - Versão Atualizada - Capa Dura
--   #651 CADVMOBL -> Caderneta De Vacinação Menino - Versão Atualizada - Capa Dura
--
-- Each page exposes the exact Product Master code and its own primary image.
-- No SKU, title, year, or marketplace data is rewritten.

do $assert_targets$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=650
      and s.sku='CADVMABL'
      and lower(p.name) like '%vacinação menina%'
  ) then raise exception 'Expected live CADVMABL target not found'; end if;

  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=651
      and s.sku='CADVMOBL'
      and lower(p.name) like '%vacinação menino%'
  ) then raise exception 'Expected live CADVMOBL target not found'; end if;

  if not exists (
    select 1
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus s on s.product_id=p.id
    where p.id=650 and s.sku='CADVMABL'
  ) then raise exception 'Expected preview CADVMABL target not found'; end if;

  if not exists (
    select 1
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus s on s.product_id=p.id
    where p.id=651 and s.sku='CADVMOBL'
  ) then raise exception 'Expected preview CADVMOBL target not found'; end if;
end
$assert_targets$;

with mappings(product_id,reference_sku,image_url) as (
  values
    (
      650::bigint,
      'CADVMABL'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/165482905422beabb5d.jpg'::text
    ),
    (
      651::bigint,
      'CADVMOBL'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/1654839658daca6a792.jpg'::text
    )
)
update public.commerce_products p
set reference_image_url=m.image_url,
    reference_image_source='NISTI_SITE_EXACT_CODE',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source='NISTI_SITE_EXACT_CODE'
  );

with mappings(product_id,reference_sku,image_url) as (
  values
    (
      650::bigint,
      'CADVMABL'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/165482905422beabb5d.jpg'::text
    ),
    (
      651::bigint,
      'CADVMOBL'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/1654839658daca6a792.jpg'::text
    )
)
update public.commerce_preview_products p
set reference_image_url=m.image_url,
    reference_image_source='NISTI_SITE_EXACT_CODE',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source='NISTI_SITE_EXACT_CODE'
  );

do $verify$
begin
  if (
    select count(*)
    from public.commerce_products
    where id in (650,651)
      and reference_image_source='NISTI_SITE_EXACT_CODE'
      and reference_image_url is not null
  ) <> 2 then raise exception 'Expected two live official-site caderneta image recoveries'; end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where id in (650,651)
      and reference_image_source='NISTI_SITE_EXACT_CODE'
      and reference_image_url is not null
  ) <> 2 then raise exception 'Expected two preview official-site caderneta image recoveries'; end if;
end
$verify$;
