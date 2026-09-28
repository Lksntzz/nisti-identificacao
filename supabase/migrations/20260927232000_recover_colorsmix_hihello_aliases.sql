-- Recover two audited legacy Product Master images from current platform aliases.
--
-- 682 CDISC NP CPG03 -> CDISC CMIX3 BB (Colors Mix 03)
-- 692 PLANHH23       -> PLAN26_HIH_BXA (Hi Hello generic, distinct from Pink)
--
-- User-approved rule: a newer artwork revision may be reused when the
-- underlying product/cover identity is confirmed.

do $assert$
begin
  if not exists (
    select 1 from public.commerce_product_skus
    where product_id=682 and sku='CDISC NP CPG03'
  ) then raise exception 'Target #682 not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus
    where product_id=692 and sku='PLANHH23'
  ) then raise exception 'Target #692 not found'; end if;
end
$assert$;

with mappings(product_id,reference_sku,url) as (
  values
    (682::bigint,'CDISC CMIX3 BB'::text,'https://cf.shopee.com.br/file/br-11134207-7r98s-lmic45n74zzrcf'::text),
    (692::bigint,'PLAN26_HIH_BXA'::text,'https://cf.shopee.com.br/file/br-11134207-7r98o-m04kxxkf0nl527'::text)
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source='PLATFORM_AUDITED_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

with mappings(product_id,reference_sku,url) as (
  values
    (682::bigint,'CDISC CMIX3 BB'::text,'https://cf.shopee.com.br/file/br-11134207-7r98s-lmic45n74zzrcf'::text),
    (692::bigint,'PLAN26_HIH_BXA'::text,'https://cf.shopee.com.br/file/br-11134207-7r98o-m04kxxkf0nl527'::text)
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source='PLATFORM_AUDITED_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

do $verify$
begin
  if (select count(*) from public.commerce_products
      where id in (682,692)
        and reference_image_source='PLATFORM_AUDITED_ALIAS'
        and reference_image_url is not null) <> 2 then
    raise exception 'Expected 2 live platform alias image recoveries';
  end if;

  if (select count(*) from public.commerce_preview_products
      where id in (682,692)
        and reference_image_source='PLATFORM_AUDITED_ALIAS'
        and reference_image_url is not null) <> 2 then
    raise exception 'Expected 2 preview platform alias image recoveries';
  end if;
end
$verify$;
