-- Restore three manually audited cross-year image aliases that were reverted
-- by 20260927220500_revert_unsafe_cross_year_image_aliases.sql.
--
-- Current catalog rule confirmed by the operator:
-- image freshness/year does NOT block reuse when the underlying product/cover
-- identity is known. This migration restores only explicitly audited aliases;
-- it does not relax the automatic year-compatibility function globally.
--
-- 457 PB26_EXEC_AZL_PXP26 -> PB27_EXEC_AZL_PXP (Executiva Azul)
-- 676 AG23FLOR01          -> AG262D TULIP BXB (Coloris Tulipa)
-- 700 PB26_NEGBC_PXP      -> PB27_NEG_BCO_PXP (Negócios Branco)

do $assert$
begin
  if not exists (
    select 1 from public.commerce_product_skus
    where product_id=457 and sku='PB26_EXEC_AZL_PXP26'
  ) then raise exception 'Target 457 not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus
    where product_id=676 and sku='AG23FLOR01'
  ) then raise exception 'Target 676 not found'; end if;

  if not exists (
    select 1 from public.commerce_product_skus
    where product_id=700 and sku='PB26_NEGBC_PXP'
  ) then raise exception 'Target 700 not found'; end if;
end
$assert$;

with mappings(product_id,reference_sku,url) as (
  values
    (457::bigint,'PB27_EXEC_AZL_PXP'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_EXEC_AZL_PXP.jpg'::text),
    (676::bigint,'AG262D TULIP BXB'::text,'https://cf.shopee.com.br/file/br-11134207-81z1k-mhgio8knbkld1c'::text),
    (700::bigint,'PB27_NEG_BCO_PXP'::text,'https://drive.google.com/thumbnail?id=1BgXz9zhQ0ok4m0c0cfk_MYf3uusaTuIh&sz=w200'::text)
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source='PRODUCT_MASTER_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id;

with mappings(product_id,reference_sku,url) as (
  values
    (457::bigint,'PB27_EXEC_AZL_PXP'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/shopee/PB27_EXEC_AZL_PXP.jpg'::text),
    (676::bigint,'AG262D TULIP BXB'::text,'https://cf.shopee.com.br/file/br-11134207-81z1k-mhgio8knbkld1c'::text),
    (700::bigint,'PB27_NEG_BCO_PXP'::text,'https://drive.google.com/thumbnail?id=1BgXz9zhQ0ok4m0c0cfk_MYf3uusaTuIh&sz=w200'::text)
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source='PRODUCT_MASTER_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id;

do $verify$
begin
  if (select count(*) from public.commerce_products
      where id in (457,676,700)
        and reference_image_source='PRODUCT_MASTER_ALIAS'
        and reference_image_url is not null) <> 3 then
    raise exception 'Expected 3 restored live aliases';
  end if;

  if (select count(*) from public.commerce_preview_products
      where id in (457,676,700)
        and reference_image_source='PRODUCT_MASTER_ALIAS'
        and reference_image_url is not null) <> 3 then
    raise exception 'Expected 3 restored preview aliases';
  end if;
end
$verify$;
