-- Recover Product Master #726 via an audited same-listing SKU alias.
--
-- Historical/current identity:
--   Product Master: PLAN26 MPO PBP
--   Current Shopee SKU: PLAN26 MPW PBP
--   Same Shopee listing: https://shopee.com.br/product/376221706/22892541313/
--   Image source: https://cf.shopee.com.br/file/br-11134207-7r98o-m04luk4wx4rt22
--
-- The operator-approved catalog rule allows reuse across artwork revisions
-- when the underlying product/listing identity is confirmed.

do $assert$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=726
      and s.sku='PLAN26 MPO PBP'
  ) then
    raise exception 'Target Product Master #726 not found';
  end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    where sr.matched_product_id=726
      and sr.normalized_payload->>'sku'='PLAN26 MPO PBP'
      and sr.normalized_payload->>'listing_url'='https://shopee.com.br/product/376221706/22892541313/'
  ) then
    raise exception 'Expected Shopee listing identity for Product Master #726 not found';
  end if;
end
$assert$;

update public.commerce_products
set reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m04luk4wx4rt22',
    reference_image_source='SAME_LISTING_SKU_ALIAS',
    reference_image_sku='PLAN26 MPW PBP',
    updated_at=now()
where id=726
  and reference_image_url is null;

update public.commerce_preview_products
set reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m04luk4wx4rt22',
    reference_image_source='SAME_LISTING_SKU_ALIAS',
    reference_image_sku='PLAN26 MPW PBP',
    updated_at=now()
where id=726
  and reference_image_url is null;

do $verify$
begin
  if not exists (
    select 1 from public.commerce_products
    where id=726
      and reference_image_source='SAME_LISTING_SKU_ALIAS'
      and reference_image_sku='PLAN26 MPW PBP'
      and reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m04luk4wx4rt22'
  ) then
    raise exception 'Live Product Master #726 image recovery failed';
  end if;

  if not exists (
    select 1 from public.commerce_preview_products
    where id=726
      and reference_image_source='SAME_LISTING_SKU_ALIAS'
      and reference_image_sku='PLAN26 MPW PBP'
      and reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m04luk4wx4rt22'
  ) then
    raise exception 'Preview Product Master #726 image recovery failed';
  end if;
end
$verify$;
