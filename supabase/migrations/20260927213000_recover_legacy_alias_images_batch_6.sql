-- Recover three audited legacy Product Master images from equivalent current
-- Product Masters. The current SKU stays unchanged; only the reference image is reused.
--
-- 672 AGENEG2205 -> Product Master 562 PB25 BCO PXP (Negócios Branco)
-- 675 AGMANIC01  -> Product Master 86 AGP2112 (Manicure Permanente)
-- 695 PLANLF01   -> Product Master 101 PLAN26_PERS_BXB (Planner Life)

do $assert$
begin
  if not exists (
    select 1 from public.commerce_product_skus where product_id=672 and sku='AGENEG2205'
  ) then raise exception 'Target 672 AGENEG2205 not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus where product_id=675 and sku='AGMANIC01'
  ) then raise exception 'Target 675 AGMANIC01 not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus where product_id=695 and sku='PLANLF01'
  ) then raise exception 'Target 695 PLANLF01 not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus where product_id=562 and sku='PB25 BCO PXP'
  ) then raise exception 'Source 562 PB25 BCO PXP not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus where product_id=86 and sku='AGP2112'
  ) then raise exception 'Source 86 AGP2112 not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus where product_id=101 and sku='PLAN26_PERS_BXB'
  ) then raise exception 'Source 101 PLAN26_PERS_BXB not found'; end if;
end
$assert$;

with mappings(product_id,reference_sku,url) as (
  values
    (672::bigint,'PB25 BCO PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/35f8565ad46132d15f980774c02f0b1b94c3587e1ffda5d3e2b79ca2eb7e850a.png'::text),
    (675::bigint,'AGP2112'::text,'https://cf.shopee.com.br/file/br-11134207-7r98o-m8ovnaxe2eflee'::text),
    (695::bigint,'PLAN26_PERS_BXB'::text,'https://cf.shopee.com.br/file/br-11134207-7r98o-m04k7ftko4tl83'::text)
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source='PRODUCT_MASTER_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

with mappings(product_id,reference_sku,url) as (
  values
    (672::bigint,'PB25 BCO PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/35f8565ad46132d15f980774c02f0b1b94c3587e1ffda5d3e2b79ca2eb7e850a.png'::text),
    (675::bigint,'AGP2112'::text,'https://cf.shopee.com.br/file/br-11134207-7r98o-m8ovnaxe2eflee'::text),
    (695::bigint,'PLAN26_PERS_BXB'::text,'https://cf.shopee.com.br/file/br-11134207-7r98o-m04k7ftko4tl83'::text)
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source='PRODUCT_MASTER_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

do $verify$
begin
  if (select count(*) from public.commerce_products
      where id in (672,675,695)
        and reference_image_source='PRODUCT_MASTER_ALIAS'
        and reference_image_url is not null) <> 3 then
    raise exception 'Expected 3 live legacy alias recoveries';
  end if;

  if (select count(*) from public.commerce_preview_products
      where id in (672,675,695)
        and reference_image_source='PRODUCT_MASTER_ALIAS'
        and reference_image_url is not null) <> 3 then
    raise exception 'Expected 3 preview legacy alias recoveries';
  end if;
end
$verify$;
