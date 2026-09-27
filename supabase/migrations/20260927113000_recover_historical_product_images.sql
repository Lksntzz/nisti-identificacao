-- Recover four audited historical images for Product Masters that still have no card image.
--
-- Sources:
-- - Nisti ID direct media:
--   #402 CADMOSF -> product 150 VACMNO_SFR_BVV (Safari menino)
--   #678 CADVMOAT -> product 4 VACMNO_URSAT_BBB (Astronauta)
-- - Curated historical Shopee image references from CATÁLOGO GERAL PROFISSIONAL / IMAGENS:
--   #401 CADMASF -> VACMNASF (Safari menina)
--   #677 F8-G9YH-724N -> VACMNOP NUV BAA (Nuvem)
--
-- These mappings were audited against product titles, historical platform SKUs,
-- and unique image references. No current SKU is rewritten.

do $assert_sources$
begin
  if not exists (
    select 1 from public.products
    where id=150
      and sku='VACMNO_SFR_BVV'
      and upper(coalesce(variacao,''))='SAFARI'
      and image_key='products/150/a36dd7d3-6f2a-47d5-9e7f-b8b6e2798900'
  ) then
    raise exception 'Expected Nisti ID Safari source product #150 not found';
  end if;

  if not exists (
    select 1 from public.products
    where id=4
      and sku='VACMNO_URSAT_BBB'
      and upper(coalesce(variacao,''))='ASTRONAUTA'
      and image_key='products/4/2f5511a7-2071-4e77-be25-9b03299fd262'
  ) then
    raise exception 'Expected Nisti ID Astronauta source product #4 not found';
  end if;

  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=401 and s.sku='CADMASF'
  ) then
    raise exception 'Expected live Product Master #401 CADMASF not found';
  end if;

  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=402 and s.sku='CADMOSF'
  ) then
    raise exception 'Expected live Product Master #402 CADMOSF not found';
  end if;

  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=677 and s.sku='F8-G9YH-724N'
  ) then
    raise exception 'Expected live Product Master #677 Nuvem not found';
  end if;

  if not exists (
    select 1 from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=678 and s.sku='CADVMOAT'
  ) then
    raise exception 'Expected live Product Master #678 CADVMOAT not found';
  end if;
end
$assert_sources$;

-- Direct Nisti ID links for Safari menino and Astronauta.
with mappings(product_id,source_product_id,matched_sku,image_key) as (
  values
    (402::bigint,150::bigint,'VACMNO_SFR_BVV'::text,'products/150/a36dd7d3-6f2a-47d5-9e7f-b8b6e2798900'::text),
    (678::bigint,4::bigint,'VACMNO_URSAT_BBB'::text,'products/4/2f5511a7-2071-4e77-be25-9b03299fd262'::text)
),
numbered as (
  select
    m.*,
    (select coalesce(max(id),0) from public.commerce_product_media_links)
      + row_number() over(order by m.product_id) as new_id
  from mappings m
)
insert into public.commerce_product_media_links
  (id,product_id,source_kind,source_product_id,matched_sku,image_key)
select new_id,product_id,'NISTI_ID',source_product_id,matched_sku,image_key
from numbered
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

with mappings(product_id,source_product_id,matched_sku,image_key) as (
  values
    (402::bigint,150::bigint,'VACMNO_SFR_BVV'::text,'products/150/a36dd7d3-6f2a-47d5-9e7f-b8b6e2798900'::text),
    (678::bigint,4::bigint,'VACMNO_URSAT_BBB'::text,'products/4/2f5511a7-2071-4e77-be25-9b03299fd262'::text)
),
numbered as (
  select
    m.*,
    (select coalesce(max(id),0) from public.commerce_preview_product_media_links)
      + row_number() over(order by m.product_id) as new_id
  from mappings m
)
insert into public.commerce_preview_product_media_links
  (id,product_id,source_kind,source_product_id,matched_sku,image_key)
select new_id,product_id,'NISTI_ID',source_product_id,matched_sku,image_key
from numbered
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

-- Historical platform image references for Safari menina and Nuvem.
update public.commerce_products
set reference_image_url=case id
      when 401 then 'https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181drar9tfd'
      when 677 then 'https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c'
    end,
    reference_image_source='SHOPEE_HISTORY',
    reference_image_sku=case id
      when 401 then 'VACMNASF'
      when 677 then 'VACMNOP NUV BAA'
    end,
    updated_at=now()
where id in (401,677);

update public.commerce_preview_products
set reference_image_url=case id
      when 401 then 'https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181drar9tfd'
      when 677 then 'https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181dreyz51c'
    end,
    reference_image_source='SHOPEE_HISTORY',
    reference_image_sku=case id
      when 401 then 'VACMNASF'
      when 677 then 'VACMNOP NUV BAA'
    end,
    updated_at=now()
where id in (401,677);

do $assert_result$
begin
  if (
    select count(*)
    from public.commerce_product_media_links
    where source_kind='NISTI_ID'
      and (
        (product_id=402 and source_product_id=150 and matched_sku='VACMNO_SFR_BVV')
        or
        (product_id=678 and source_product_id=4 and matched_sku='VACMNO_URSAT_BBB')
      )
  ) <> 2 then
    raise exception 'Live Nisti ID historical media recovery count mismatch';
  end if;

  if (
    select count(*)
    from public.commerce_preview_product_media_links
    where source_kind='NISTI_ID'
      and (
        (product_id=402 and source_product_id=150 and matched_sku='VACMNO_SFR_BVV')
        or
        (product_id=678 and source_product_id=4 and matched_sku='VACMNO_URSAT_BBB')
      )
  ) <> 2 then
    raise exception 'Preview Nisti ID historical media recovery count mismatch';
  end if;

  if (
    select count(*)
    from public.commerce_products
    where (id=401 and reference_image_sku='VACMNASF')
       or (id=677 and reference_image_sku='VACMNOP NUV BAA')
  ) <> 2 then
    raise exception 'Live historical reference image recovery count mismatch';
  end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where (id=401 and reference_image_sku='VACMNASF')
       or (id=677 and reference_image_sku='VACMNOP NUV BAA')
  ) <> 2 then
    raise exception 'Preview historical reference image recovery count mismatch';
  end if;
end
$assert_result$;
