-- Verified Drive reference image for Primavera Lilas 2027 / Verde.
--
-- Source folder text explicitly maps the green cover to PB27_PMVR_VERD_PXP,
-- EAN 7898764980415. The reviewed green mockup was copied to the public
-- NistiWork reference-image repository so the commerce UI does not depend on
-- an authenticated Google Drive session.

do $precheck$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus ps on ps.product_id=p.id
    where p.id=659
      and p.edition_year=2027
      and ps.sku='PB27_PMVR_VERD_PXP'
  ) then
    raise exception 'Expected live Product Master #659 / PB27_PMVR_VERD_PXP not found';
  end if;

  if not exists (
    select 1
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus ps on ps.product_id=p.id
    where p.id=659
      and p.edition_year=2027
      and ps.sku='PB27_PMVR_VERD_PXP'
  ) then
    raise exception 'Expected preview Product Master #659 / PB27_PMVR_VERD_PXP not found';
  end if;
end
$precheck$;

update public.commerce_products
set reference_image_url='https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PB27_PMVR_VERD_PXP.png',
    reference_image_source='NISTIWORK_DRIVE_VERIFIED',
    reference_image_sku='PB27_PMVR_VERD_PXP',
    updated_at=now()
where id=659
  and edition_year=2027;

update public.commerce_preview_products
set reference_image_url='https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PB27_PMVR_VERD_PXP.png',
    reference_image_source='NISTIWORK_DRIVE_VERIFIED',
    reference_image_sku='PB27_PMVR_VERD_PXP',
    updated_at=now()
where id=659
  and edition_year=2027;

do $assert$
begin
  if not exists (
    select 1
    from public.commerce_products
    where id=659
      and reference_image_url='https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PB27_PMVR_VERD_PXP.png'
      and reference_image_source='NISTIWORK_DRIVE_VERIFIED'
      and reference_image_sku='PB27_PMVR_VERD_PXP'
  ) then
    raise exception 'Live Primavera Verde reference image mismatch';
  end if;

  if not exists (
    select 1
    from public.commerce_preview_products
    where id=659
      and reference_image_url='https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PB27_PMVR_VERD_PXP.png'
      and reference_image_source='NISTIWORK_DRIVE_VERIFIED'
      and reference_image_sku='PB27_PMVR_VERD_PXP'
  ) then
    raise exception 'Preview Primavera Verde reference image mismatch';
  end if;
end
$assert$;
