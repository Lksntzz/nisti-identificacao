-- Recover the Cute Rainbow 2026 Product Master image from its matched Shopee snapshot.
--
-- Product Master #470 is PLAN26_RNBW_BXR / edition 2026.
-- Snapshot #198 is MATCHED, declares parent_sku PLAN26_RNBW_BXR, and its title
-- explicitly identifies Planner 2026 Cute Rainbow. The historical listing SKU
-- PLAN25_RNBW_BXR is not used as image identity.

do $precheck$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus ps on ps.product_id=p.id
    where p.id=470
      and p.edition_year=2026
      and ps.sku='PLAN26_RNBW_BXR'
  ) then
    raise exception 'Expected live Cute Rainbow 2026 Product Master not found';
  end if;

  if not exists (
    select 1
    from public.commerce_marketplace_snapshots s
    join public.commerce_listings l on l.id=s.listing_id
    join public.commerce_listing_products lp on lp.listing_id=l.id
    where s.id=198
      and lp.product_id=470
      and s.match_status='MATCHED'
      and s.parent_sku='PLAN26_RNBW_BXR'
      and s.title ilike '%2026%'
      and s.title ilike '%Cute Rainbow%'
      and s.cover_image_url='https://cf.shopee.com.br/file/br-11134207-81z1k-mfbkndtvr7ye61'
      and public.commerce_image_years_compatible(
        'PLAN26_RNBW_BXR',s.parent_sku,s.title
      )
  ) then
    raise exception 'Expected matched Cute Rainbow 2026 snapshot not found';
  end if;

  if not exists (
    select 1
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus ps on ps.product_id=p.id
    where p.id=470
      and p.edition_year=2026
      and ps.sku='PLAN26_RNBW_BXR'
  ) then
    raise exception 'Expected preview Cute Rainbow 2026 Product Master not found';
  end if;
end
$precheck$;

update public.commerce_products
set reference_image_url='https://cf.shopee.com.br/file/br-11134207-81z1k-mfbkndtvr7ye61',
    reference_image_source='MATCHED_SNAPSHOT',
    reference_image_sku='PLAN26_RNBW_BXR',
    updated_at=now()
where id=470
  and (
    reference_image_url is null
    or reference_image_source='MATCHED_SNAPSHOT'
  );

update public.commerce_preview_products
set reference_image_url='https://cf.shopee.com.br/file/br-11134207-81z1k-mfbkndtvr7ye61',
    reference_image_source='MATCHED_SNAPSHOT',
    reference_image_sku='PLAN26_RNBW_BXR',
    updated_at=now()
where id=470
  and (
    reference_image_url is null
    or reference_image_source='MATCHED_SNAPSHOT'
  );

do $verify$
begin
  if not exists (
    select 1 from public.commerce_products
    where id=470
      and reference_image_source='MATCHED_SNAPSHOT'
      and reference_image_sku='PLAN26_RNBW_BXR'
      and reference_image_url='https://cf.shopee.com.br/file/br-11134207-81z1k-mfbkndtvr7ye61'
  ) then
    raise exception 'Live Cute Rainbow image recovery failed';
  end if;

  if not exists (
    select 1 from public.commerce_preview_products
    where id=470
      and reference_image_source='MATCHED_SNAPSHOT'
      and reference_image_sku='PLAN26_RNBW_BXR'
      and reference_image_url='https://cf.shopee.com.br/file/br-11134207-81z1k-mfbkndtvr7ye61'
  ) then
    raise exception 'Preview Cute Rainbow image recovery failed';
  end if;
end
$verify$;
