-- Recover audited Product Master images by copying the image identity of an
-- already-linked equivalent Product Master.
--
-- User rule for this catalog: the image may be from a newer artwork revision
-- when the underlying product/cover identity is the same.
--
-- Audited aliases:
-- 457 PB26_EXEC_AZL_PXP26 -> Product Master 82 PB26_EXEC_AZL_PXP (Executiva Azul)
-- 676 AG23FLOR01          -> Product Master 87 AG262D TULIP BXB (Coloris Tulipa)
-- 698 PB26_NEGCZ_PXP      -> Product Master 460 PB26_NEG_CINZ_PXP (Negócios Cinza)
-- 700 PB26_NEGBC_PXP      -> Product Master 656 PB27_NEG_BCO_PXP (Negócios Branco)

do $assert$
begin
  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=457 and s.sku='PB26_EXEC_AZL_PXP26'
  ) then raise exception 'Target 457 not found'; end if;

  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=676 and s.sku='AG23FLOR01'
  ) then raise exception 'Target 676 not found'; end if;

  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=698 and s.sku='PB26_NEGCZ_PXP'
  ) then raise exception 'Target 698 not found'; end if;

  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=700 and s.sku='PB26_NEGBC_PXP'
  ) then raise exception 'Target 700 not found'; end if;
end
$assert$;

with mappings(product_id,reference_sku,url) as (
  values
    (457::bigint,'PB26_EXEC_AZL_PXP'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_EXEC_AZL_PXP.jpg'::text),
    (676::bigint,'AG262D TULIP BXB'::text,'https://cf.shopee.com.br/file/br-11134207-81z1k-mhgio8knbkld1c'::text),
    (698::bigint,'PB26_NEG_CINZ_PXP'::text,'https://drive.google.com/thumbnail?id=1WnBK_aShxv2iS5r5-mGV0Qbv_oauM87Y&sz=w200'::text),
    (700::bigint,'PB27_NEG_BCO_PXP'::text,'https://drive.google.com/thumbnail?id=1BgXz9zhQ0ok4m0c0cfk_MYf3uusaTuIh&sz=w200'::text)
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
    (457::bigint,'PB26_EXEC_AZL_PXP'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_EXEC_AZL_PXP.jpg'::text),
    (676::bigint,'AG262D TULIP BXB'::text,'https://cf.shopee.com.br/file/br-11134207-81z1k-mhgio8knbkld1c'::text),
    (698::bigint,'PB26_NEG_CINZ_PXP'::text,'https://drive.google.com/thumbnail?id=1WnBK_aShxv2iS5r5-mGV0Qbv_oauM87Y&sz=w200'::text),
    (700::bigint,'PB27_NEG_BCO_PXP'::text,'https://drive.google.com/thumbnail?id=1BgXz9zhQ0ok4m0c0cfk_MYf3uusaTuIh&sz=w200'::text)
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
      where id in (457,676,698,700)
        and reference_image_source='PRODUCT_MASTER_ALIAS'
        and reference_image_url is not null) <> 4 then
    raise exception 'Expected 4 live alias image recoveries';
  end if;

  if (select count(*) from public.commerce_preview_products
      where id in (457,676,698,700)
        and reference_image_source='PRODUCT_MASTER_ALIAS'
        and reference_image_url is not null) <> 4 then
    raise exception 'Expected 4 preview alias image recoveries';
  end if;
end
$verify$;
