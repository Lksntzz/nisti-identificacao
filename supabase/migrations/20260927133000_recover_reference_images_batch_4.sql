-- Recover seven audited Product Master images.
--
-- Evidence was cross-checked against the year-correct official Drive art folders,
-- marketplace history, and Nisti ID. No Product Master SKU is rewritten.
--
-- Nisti ID:
--   #691 P5-PNSL-B028 (Café e Propósito)
--     -> Nisti ID #124 DEVNP_CPT3_RBB, CAPA 3.
--     The official Drive mockup for CAPA 3 reads "Café, Oração & Propósito".
--
-- Public reference images copied from the official Drive art folders to NistiWork:
--   #648 CADRMR02                  -> CADRMR02_PRETO.jpg
--   #649 CADRMR04                  -> CADRMR04_LOIRO.jpg
--   #709 PLAN26_IAR_BXB            -> PLAN26_IAR_BXB.png
--   #550 AGMT26_MAN02_PBB          -> AGMT26_MAN02_PBB.png
--   #457 PB26_EXEC_AZL_PXP26       -> PB26_EXEC_AZL_PXP26.png
--   #726 PLAN26 MPO PBP            -> PLAN26_MPO_PBP.png

do $assert_sources$
begin
  if not exists (
    select 1
    from public.products
    where id=124
      and sku='DEVNP_CPT3_RBB'
      and capa_code='CPT3'
      and image_key='products/124/0b024a08-e63d-484c-b566-c9f793c68eed'
  ) then
    raise exception 'Expected Nisti ID source #124 DEVNP_CPT3_RBB not found';
  end if;

  if (
    select count(distinct p.id)
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where
      (p.id=457 and s.sku='PB26_EXEC_AZL_PXP26')
      or (p.id=550 and s.sku='AGMT26_MAN02_PBB')
      or (p.id=648 and s.sku='CADRMR02')
      or (p.id=649 and s.sku='CADRMR04')
      or (p.id=691 and s.sku='P5-PNSL-B028')
      or (p.id=709 and s.sku='PLAN26_IAR_BXB')
      or (p.id=726 and s.sku='PLAN26 MPO PBP')
  ) <> 7 then
    raise exception 'One or more live Product Master targets are missing or changed';
  end if;

  if (
    select count(distinct p.id)
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus s on s.product_id=p.id
    where
      (p.id=457 and s.sku='PB26_EXEC_AZL_PXP26')
      or (p.id=550 and s.sku='AGMT26_MAN02_PBB')
      or (p.id=648 and s.sku='CADRMR02')
      or (p.id=649 and s.sku='CADRMR04')
      or (p.id=691 and s.sku='P5-PNSL-B028')
      or (p.id=709 and s.sku='PLAN26_IAR_BXB')
      or (p.id=726 and s.sku='PLAN26 MPO PBP')
  ) <> 7 then
    raise exception 'One or more preview Product Master targets are missing or changed';
  end if;

  if exists (
    select 1 from public.commerce_product_media_links
    where product_id=691 and source_kind='NISTI_ID'
  ) then
    raise exception 'Live Product Master #691 already has a Nisti ID media link';
  end if;

  if exists (
    select 1 from public.commerce_preview_product_media_links
    where product_id=691 and source_kind='NISTI_ID'
  ) then
    raise exception 'Preview Product Master #691 already has a Nisti ID media link';
  end if;

  if exists (
    select 1 from public.commerce_products
    where id in (457,550,648,649,709,726)
      and reference_image_url is not null
  ) then
    raise exception 'One or more live reference-image targets are no longer empty';
  end if;

  if exists (
    select 1 from public.commerce_preview_products
    where id in (457,550,648,649,709,726)
      and reference_image_url is not null
  ) then
    raise exception 'One or more preview reference-image targets are no longer empty';
  end if;
end
$assert_sources$;

-- Café e Propósito: direct Nisti ID media link.
with next_id as (
  select coalesce(max(id),0)+1 as id
  from public.commerce_product_media_links
)
insert into public.commerce_product_media_links
  (id,product_id,source_kind,source_product_id,matched_sku,image_key)
select
  next_id.id,
  691,
  'NISTI_ID',
  124,
  'DEVNP_CPT3_RBB',
  'products/124/0b024a08-e63d-484c-b566-c9f793c68eed'
from next_id;

with next_id as (
  select coalesce(max(id),0)+1 as id
  from public.commerce_preview_product_media_links
)
insert into public.commerce_preview_product_media_links
  (id,product_id,source_kind,source_product_id,matched_sku,image_key)
select
  next_id.id,
  691,
  'NISTI_ID',
  124,
  'DEVNP_CPT3_RBB',
  'products/124/0b024a08-e63d-484c-b566-c9f793c68eed'
from next_id;

-- Year-/variant-audited public reference images.
with mappings(product_id,reference_sku,url) as (
  values
    (457::bigint,'PB26_EXEC_AZL_PXP26'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PB26_EXEC_AZL_PXP26.png'::text),
    (550::bigint,'AGMT26_MAN02_PBB'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/AGMT26_MAN02_PBB.png'::text),
    (648::bigint,'CADRMR02'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/CADRMR02_PRETO.jpg'::text),
    (649::bigint,'CADRMR04'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/CADRMR04_LOIRO.jpg'::text),
    (709::bigint,'PLAN26_IAR_BXB'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PLAN26_IAR_BXB.png'::text),
    (726::bigint,'PLAN26 MPO PBP'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PLAN26_MPO_PBP.png'::text)
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source='NISTIWORK_DRIVE_VERIFIED',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

with mappings(product_id,reference_sku,url) as (
  values
    (457::bigint,'PB26_EXEC_AZL_PXP26'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PB26_EXEC_AZL_PXP26.png'::text),
    (550::bigint,'AGMT26_MAN02_PBB'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/AGMT26_MAN02_PBB.png'::text),
    (648::bigint,'CADRMR02'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/CADRMR02_PRETO.jpg'::text),
    (649::bigint,'CADRMR04'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/CADRMR04_LOIRO.jpg'::text),
    (709::bigint,'PLAN26_IAR_BXB'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PLAN26_IAR_BXB.png'::text),
    (726::bigint,'PLAN26 MPO PBP'::text,'https://raw.githubusercontent.com/Lksntzz/NistiWork/main/catalog-thumbnails/reference/PLAN26_MPO_PBP.png'::text)
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source='NISTIWORK_DRIVE_VERIFIED',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

do $verify$
begin
  if not exists (
    select 1
    from public.commerce_product_media_links
    where product_id=691
      and source_kind='NISTI_ID'
      and source_product_id=124
      and matched_sku='DEVNP_CPT3_RBB'
  ) then
    raise exception 'Live Café e Propósito Nisti ID link was not applied';
  end if;

  if not exists (
    select 1
    from public.commerce_preview_product_media_links
    where product_id=691
      and source_kind='NISTI_ID'
      and source_product_id=124
      and matched_sku='DEVNP_CPT3_RBB'
  ) then
    raise exception 'Preview Café e Propósito Nisti ID link was not applied';
  end if;

  if (
    select count(*)
    from public.commerce_products
    where id in (457,550,648,649,709,726)
      and reference_image_source='NISTIWORK_DRIVE_VERIFIED'
      and reference_image_url is not null
  ) <> 6 then
    raise exception 'Expected six live NistiWork reference images';
  end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where id in (457,550,648,649,709,726)
      and reference_image_source='NISTIWORK_DRIVE_VERIFIED'
      and reference_image_url is not null
  ) <> 6 then
    raise exception 'Expected six preview NistiWork reference images';
  end if;
end
$verify$;
