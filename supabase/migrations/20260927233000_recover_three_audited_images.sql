-- Recover three audited Product Master images.
--
-- 15  PB26_SPNGB_PXP -> Spring Breeze Verde.
--     Evidence: the Product Master's ML listing URL encodes CAPA_vpp=Verde;
--     Drive catalog confirms Verde as Spring Breeze variant SKU.
-- 686 YE-U3ZJ-UJXA -> DEVPS CORS BBA (Devocional Colors).
--     Evidence: target title is Devocional Colors and GS variant code CORS.
-- 691 P5-PNSL-B028 -> DEVNP_CPT3_RBB / Nisti ID product #124.
--     Evidence: Drive mockup CAPA 3 visibly reads "Café, Oração & Propósito".

do $assert_targets$
begin
  if not exists (
    select 1
    from public.commerce_product_skus
    where product_id=15 and sku='PB26_SPNGB_PXP'
  ) then raise exception 'Target #15 not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows
    where matched_product_id=15
      and normalized_payload->>'listing_url' like '%CAPA_vpp%3AVmVyZGU%'
  ) then raise exception 'Spring Breeze Verde listing evidence not found'; end if;

  if not exists (
    select 1
    from public.commerce_product_skus
    where product_id=686 and sku='YE-U3ZJ-UJXA'
  ) then raise exception 'Target #686 not found'; end if;

  if not exists (
    select 1
    from public.commerce_product_skus
    where product_id=691 and sku='P5-PNSL-B028'
  ) then raise exception 'Target #691 not found'; end if;

  if not exists (
    select 1
    from public.products
    where id=124
      and sku='DEVNP_CPT3_RBB'
      and image_key='products/124/0b024a08-e63d-484c-b566-c9f793c68eed'
  ) then raise exception 'Nisti ID CAPA 3 source product #124 not found'; end if;
end
$assert_targets$;

-- Spring Breeze Verde and Devocional Colors use audited GS references.
with mappings(product_id,reference_sku,url,source) as (
  values
    (
      15::bigint,
      'PB25_SPNGB_VERD_PXP'::text,
      'https://cnp30blob.blob.core.windows.net/cnp3files/d46b94133177516c6ecca4db137ffb724248d4fd035d3d09f10b2b6ecfda4771.png'::text,
      'GS_AUDITED_VARIANT'::text
    ),
    (
      686::bigint,
      'DEVPS CORS BBA'::text,
      'https://cnp30blob.blob.core.windows.net/cnp3files/8b70d92c86171c1150cc9eac5fefd95d1a9d5b4e3c9fe094a593b536a2b44bbb.png'::text,
      'GS_AUDITED_ALIAS'::text
    )
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source=m.source,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

with mappings(product_id,reference_sku,url,source) as (
  values
    (
      15::bigint,
      'PB25_SPNGB_VERD_PXP'::text,
      'https://cnp30blob.blob.core.windows.net/cnp3files/d46b94133177516c6ecca4db137ffb724248d4fd035d3d09f10b2b6ecfda4771.png'::text,
      'GS_AUDITED_VARIANT'::text
    ),
    (
      686::bigint,
      'DEVPS CORS BBA'::text,
      'https://cnp30blob.blob.core.windows.net/cnp3files/8b70d92c86171c1150cc9eac5fefd95d1a9d5b4e3c9fe094a593b536a2b44bbb.png'::text,
      'GS_AUDITED_ALIAS'::text
    )
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source=m.source,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

-- Café e Propósito uses the exact Nisti ID CAPA 3 media.
with next_id as (
  select coalesce(max(id),0)+1 id from public.commerce_product_media_links
)
insert into public.commerce_product_media_links
  (id,product_id,source_kind,source_product_id,matched_sku,image_key)
select id,691,'NISTI_ID',124,'DEVNP_CPT3_RBB','products/124/0b024a08-e63d-484c-b566-c9f793c68eed'
from next_id
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

with next_id as (
  select coalesce(max(id),0)+1 id from public.commerce_preview_product_media_links
)
insert into public.commerce_preview_product_media_links
  (id,product_id,source_kind,source_product_id,matched_sku,image_key)
select id,691,'NISTI_ID',124,'DEVNP_CPT3_RBB','products/124/0b024a08-e63d-484c-b566-c9f793c68eed'
from next_id
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

do $verify$
begin
  if (select count(*) from public.commerce_products
      where id in (15,686)
        and reference_image_url is not null) <> 2 then
    raise exception 'Expected 2 live GS image recoveries'; end if;

  if (select count(*) from public.commerce_preview_products
      where id in (15,686)
        and reference_image_url is not null) <> 2 then
    raise exception 'Expected 2 preview GS image recoveries'; end if;

  if not exists (
    select 1 from public.commerce_product_media_links
    where product_id=691
      and source_kind='NISTI_ID'
      and source_product_id=124
      and matched_sku='DEVNP_CPT3_RBB'
  ) then raise exception 'Live Café e Propósito Nisti link missing'; end if;

  if not exists (
    select 1 from public.commerce_preview_product_media_links
    where product_id=691
      and source_kind='NISTI_ID'
      and source_product_id=124
      and matched_sku='DEVNP_CPT3_RBB'
  ) then raise exception 'Preview Café e Propósito Nisti link missing'; end if;
end
$verify$;
