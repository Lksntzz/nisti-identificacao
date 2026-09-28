-- Revert unsafe cross-year Product Master image aliases.
--
-- Catalog invariant: artwork year is part of image identity.
-- A PB26/AG23 Product Master must not inherit a PB27/AG26 artwork image.
--
-- Keep product #698 because PB26_NEGCZ -> PB26_NEG_CINZ stays within 2026.
-- Revert:
--   #457 PB26_EXEC_AZL_PXP26 -> image file PB27_EXEC_AZL_PXP.jpg
--   #676 AG23FLOR01          -> AG262D TULIP BXB
--   #700 PB26_NEGBC_PXP      -> PB27_NEG_BCO_PXP

do $assert$
begin
  if not exists (
    select 1 from public.commerce_products
    where id=457
      and reference_image_source='PRODUCT_MASTER_ALIAS'
      and reference_image_sku='PB26_EXEC_AZL_PXP'
      and reference_image_url like '%PB27_EXEC_AZL_PXP%'
  ) then raise exception 'Expected unsafe live alias #457 not found'; end if;

  if not exists (
    select 1 from public.commerce_products
    where id=676
      and reference_image_source='PRODUCT_MASTER_ALIAS'
      and reference_image_sku='AG262D TULIP BXB'
  ) then raise exception 'Expected unsafe live alias #676 not found'; end if;

  if not exists (
    select 1 from public.commerce_products
    where id=700
      and reference_image_source='PRODUCT_MASTER_ALIAS'
      and reference_image_sku='PB27_NEG_BCO_PXP'
  ) then raise exception 'Expected unsafe live alias #700 not found'; end if;

  if not exists (
    select 1 from public.commerce_products
    where id=698
      and reference_image_source='PRODUCT_MASTER_ALIAS'
      and reference_image_sku='PB26_NEG_CINZ_PXP'
  ) then raise exception 'Expected safe same-year alias #698 not found'; end if;
end
$assert$;

update public.commerce_products
set reference_image_url=null,
    reference_image_source=null,
    reference_image_sku=null,
    updated_at=now()
where
  (id=457 and reference_image_source='PRODUCT_MASTER_ALIAS' and reference_image_url like '%PB27_EXEC_AZL_PXP%')
  or
  (id=676 and reference_image_source='PRODUCT_MASTER_ALIAS' and reference_image_sku='AG262D TULIP BXB')
  or
  (id=700 and reference_image_source='PRODUCT_MASTER_ALIAS' and reference_image_sku='PB27_NEG_BCO_PXP');

update public.commerce_preview_products
set reference_image_url=null,
    reference_image_source=null,
    reference_image_sku=null,
    updated_at=now()
where
  (id=457 and reference_image_source='PRODUCT_MASTER_ALIAS' and reference_image_url like '%PB27_EXEC_AZL_PXP%')
  or
  (id=676 and reference_image_source='PRODUCT_MASTER_ALIAS' and reference_image_sku='AG262D TULIP BXB')
  or
  (id=700 and reference_image_source='PRODUCT_MASTER_ALIAS' and reference_image_sku='PB27_NEG_BCO_PXP');

do $verify$
begin
  if exists (
    select 1 from public.commerce_products
    where id in (457,676,700)
      and reference_image_source='PRODUCT_MASTER_ALIAS'
  ) then raise exception 'Unsafe live aliases were not fully reverted'; end if;

  if exists (
    select 1 from public.commerce_preview_products
    where id in (457,676,700)
      and reference_image_source='PRODUCT_MASTER_ALIAS'
  ) then raise exception 'Unsafe preview aliases were not fully reverted'; end if;

  if not exists (
    select 1 from public.commerce_products
    where id=698
      and reference_image_source='PRODUCT_MASTER_ALIAS'
      and reference_image_sku='PB26_NEG_CINZ_PXP'
      and reference_image_url is not null
  ) then raise exception 'Safe same-year alias #698 was unexpectedly changed'; end if;
end
$verify$;
