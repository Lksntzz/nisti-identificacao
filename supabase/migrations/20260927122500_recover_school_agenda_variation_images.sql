-- Recover Agenda Escolar variation images from the matched Shopee snapshots.
--
-- Listing 17389649162 exposes named girl variations:
-- Castanho, Cacheado, Loiro, Ruivo.
-- Listing 22505193751 exposes CAPA 01..05 for boys.
-- These URLs come from commerce_marketplace_snapshots.variation_options and
-- are mapped only to the exact audited Product Masters below.

with mapping(product_id,reference_sku,image_url) as (
  values
    (722::bigint,'CADMNA CAST BA','https://cf.shopee.com.br/file/sg-11134201-22110-syjqbea4htjv33'),
    (725::bigint,'CADMNA CACH BA','https://cf.shopee.com.br/file/sg-11134201-22110-sqx4kag4htjve6'),
    (723::bigint,'CADMNA LOI BA','https://cf.shopee.com.br/file/sg-11134201-22110-azy395m4htjv1f'),
    (724::bigint,'CADMNA RUI BA','https://cf.shopee.com.br/file/sg-11134201-22110-98i6hiq4htjva9'),
    (674::bigint,'AGESCINMO_01','https://cf.shopee.com.br/file/sg-11134201-22110-7er8zw5gitjve0'),
    (664::bigint,'CADMNO CP2 BB','https://cf.shopee.com.br/file/sg-11134201-22110-2colw8dhitjveb'),
    (665::bigint,'CADMNO CP3 BB','https://cf.shopee.com.br/file/sg-11134201-22110-lct16flhitjv57'),
    (666::bigint,'CADMNO CP4 BB','https://cf.shopee.com.br/file/sg-11134201-22110-zcwzc1shitjvd7'),
    (667::bigint,'CADMNO CP5 BB','https://cf.shopee.com.br/file/sg-11134201-22110-6vpeouyhitjv03')
)
update public.commerce_products p
set reference_image_url=m.image_url,
    reference_image_source='SHOPEE_VARIATION_SNAPSHOT',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mapping m
where p.id=m.product_id
  and (p.reference_image_url is null or p.reference_image_source='SHOPEE_VARIATION_SNAPSHOT');

with mapping(product_id,reference_sku,image_url) as (
  values
    (722::bigint,'CADMNA CAST BA','https://cf.shopee.com.br/file/sg-11134201-22110-syjqbea4htjv33'),
    (725::bigint,'CADMNA CACH BA','https://cf.shopee.com.br/file/sg-11134201-22110-sqx4kag4htjve6'),
    (723::bigint,'CADMNA LOI BA','https://cf.shopee.com.br/file/sg-11134201-22110-azy395m4htjv1f'),
    (724::bigint,'CADMNA RUI BA','https://cf.shopee.com.br/file/sg-11134201-22110-98i6hiq4htjva9'),
    (674::bigint,'AGESCINMO_01','https://cf.shopee.com.br/file/sg-11134201-22110-7er8zw5gitjve0'),
    (664::bigint,'CADMNO CP2 BB','https://cf.shopee.com.br/file/sg-11134201-22110-2colw8dhitjveb'),
    (665::bigint,'CADMNO CP3 BB','https://cf.shopee.com.br/file/sg-11134201-22110-lct16flhitjv57'),
    (666::bigint,'CADMNO CP4 BB','https://cf.shopee.com.br/file/sg-11134201-22110-zcwzc1shitjvd7'),
    (667::bigint,'CADMNO CP5 BB','https://cf.shopee.com.br/file/sg-11134201-22110-6vpeouyhitjv03')
)
update public.commerce_preview_products p
set reference_image_url=m.image_url,
    reference_image_source='SHOPEE_VARIATION_SNAPSHOT',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mapping m
where p.id=m.product_id
  and (p.reference_image_url is null or p.reference_image_source='SHOPEE_VARIATION_SNAPSHOT');

do $assert$
begin
  if (
    select count(*)
    from public.commerce_products
    where id in (664,665,666,667,674,722,723,724,725)
      and reference_image_source='SHOPEE_VARIATION_SNAPSHOT'
      and reference_image_url is not null
  ) <> 9 then raise exception 'Live school variation image recovery mismatch'; end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where id in (664,665,666,667,674,722,723,724,725)
      and reference_image_source='SHOPEE_VARIATION_SNAPSHOT'
      and reference_image_url is not null
  ) <> 9 then raise exception 'Preview school variation image recovery mismatch'; end if;
end
$assert$;
