-- Recover Product Master #655 (Minimalista Black) from the exact GS reference.
--
-- Target:
--   PTD200 MINB BXB
--   Caderno De Anotações - 200 Pg - Coleção Minimalista - Black
--
-- GS reference row #5198:
--   PTD200 MINB B B
--   Nisti Print Caderno De Anotações -200 Pg- Coleção Minimalista - Black
--
-- The normalized product name is exact, there is one image candidate, and
-- there is no artwork-year conflict. No Product Master SKU is rewritten.

do $assert$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus ps on ps.product_id=p.id
    where p.id=655
      and ps.sku='PTD200 MINB BXB'
      and regexp_replace(lower(p.name),'[^[:alnum:]]+','','g')
          =regexp_replace(lower('Caderno De Anotações - 200 Pg - Coleção Minimalista - Black'),'[^[:alnum:]]+','','g')
  ) then raise exception 'Expected live Minimalista Black Product Master not found'; end if;

  if not exists (
    select 1
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus ps on ps.product_id=p.id
    where p.id=655
      and ps.sku='PTD200 MINB BXB'
  ) then raise exception 'Expected preview Minimalista Black Product Master not found'; end if;

  if (
    select count(*)
    from public.commerce_source_rows sr
    join public.commerce_source_files sf on sf.id=sr.source_file_id
    where sf.source_code='GS_REFERENCIA'
      and sr.id=5198
      and sr.normalized_payload->>'sku'='PTD200 MINB B B'
      and sr.normalized_payload->>'image_url'
          ='https://cnp30blob.blob.core.windows.net/cnp3files/38134080a3d395dceb00c9dfbcc90bdfe381aaeb3d0f68b6cb20841dbfd9630c.jpeg'
  ) <> 1 then raise exception 'Expected live GS Minimalista Black source not found'; end if;

  if (
    select count(*)
    from public.commerce_preview_source_rows sr
    join public.commerce_preview_source_files sf on sf.id=sr.source_file_id
    where sf.source_code='GS_REFERENCIA'
      and sr.id=5198
      and sr.normalized_payload->>'sku'='PTD200 MINB B B'
      and sr.normalized_payload->>'image_url'
          ='https://cnp30blob.blob.core.windows.net/cnp3files/38134080a3d395dceb00c9dfbcc90bdfe381aaeb3d0f68b6cb20841dbfd9630c.jpeg'
  ) <> 1 then raise exception 'Expected preview GS Minimalista Black source not found'; end if;
end
$assert$;

update public.commerce_products
set reference_image_url='https://cnp30blob.blob.core.windows.net/cnp3files/38134080a3d395dceb00c9dfbcc90bdfe381aaeb3d0f68b6cb20841dbfd9630c.jpeg',
    reference_image_source='GS_EXACT_NAME',
    reference_image_sku='PTD200 MINB B B',
    updated_at=now()
where id=655
  and reference_image_url is null;

update public.commerce_preview_products
set reference_image_url='https://cnp30blob.blob.core.windows.net/cnp3files/38134080a3d395dceb00c9dfbcc90bdfe381aaeb3d0f68b6cb20841dbfd9630c.jpeg',
    reference_image_source='GS_EXACT_NAME',
    reference_image_sku='PTD200 MINB B B',
    updated_at=now()
where id=655
  and reference_image_url is null;

do $verify$
begin
  if not exists (
    select 1 from public.commerce_products
    where id=655
      and reference_image_source='GS_EXACT_NAME'
      and reference_image_sku='PTD200 MINB B B'
  ) then raise exception 'Live Minimalista Black image not applied'; end if;

  if not exists (
    select 1 from public.commerce_preview_products
    where id=655
      and reference_image_source='GS_EXACT_NAME'
      and reference_image_sku='PTD200 MINB B B'
  ) then raise exception 'Preview Minimalista Black image not applied'; end if;
end
$verify$;
