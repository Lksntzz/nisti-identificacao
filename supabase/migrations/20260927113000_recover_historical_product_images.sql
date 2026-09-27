-- Recover the audited historical image for Product Master #677 (Nuvem).
--
-- The current Product Master SKU is F8-G9YH-724N and the historical platform
-- image catalog contains one unique Nuvem image under SKU "VACMNOP NUV BAA".
-- The same URL is referenced by Shopee and ML Novo in the catalog.
-- No Product Master SKU is rewritten.

do $assert$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=677
      and s.sku='F8-G9YH-724N'
      and lower(p.name) like '%nuvem%'
  ) then
    raise exception 'Expected live Product Master #677 Nuvem not found';
  end if;

  if not exists (
    select 1
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus s on s.product_id=p.id
    where p.id=677
      and s.sku='F8-G9YH-724N'
      and lower(p.name) like '%nuvem%'
  ) then
    raise exception 'Expected preview Product Master #677 Nuvem not found';
  end if;
end
$assert$;

update public.commerce_products
set reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c',
    reference_image_source='SHOPEE_HISTORY',
    reference_image_sku='VACMNOP NUV BAA',
    updated_at=now()
where id=677
  and (
    reference_image_url is null
    or reference_image_source='SHOPEE_HISTORY'
  );

update public.commerce_preview_products
set reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c',
    reference_image_source='SHOPEE_HISTORY',
    reference_image_sku='VACMNOP NUV BAA',
    updated_at=now()
where id=677
  and (
    reference_image_url is null
    or reference_image_source='SHOPEE_HISTORY'
  );

do $verify$
begin
  if not exists (
    select 1 from public.commerce_products
    where id=677
      and reference_image_sku='VACMNOP NUV BAA'
      and reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c'
  ) then
    raise exception 'Live Nuvem historical image was not applied';
  end if;

  if not exists (
    select 1 from public.commerce_preview_products
    where id=677
      and reference_image_sku='VACMNOP NUV BAA'
      and reference_image_url='https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c'
  ) then
    raise exception 'Preview Nuvem historical image was not applied';
  end if;
end
$verify$;
