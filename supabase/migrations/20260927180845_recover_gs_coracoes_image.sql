-- Recover Product Master #702 (Corações) from an audited GS alias.
--
-- Target:
--   PTD200 COR BXB
--   Caderno De Anotações - 200 Pg - Corações Rosa Corações
--
-- GS reference row #5200:
--   PTD200 COR B B
--   Nisti Print Caderno De Anotações - 200 Pg - Corações
--
-- GS contains a single Caderno de Anotações "Corações" image and the artwork
-- has no year conflict. No Product Master SKU is rewritten.

do $assert$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus ps on ps.product_id=p.id
    where p.id=702
      and ps.sku='PTD200 COR BXB'
      and lower(p.name) like '%corações%'
  ) then raise exception 'Expected live Corações Product Master not found'; end if;

  if not exists (
    select 1
    from public.commerce_preview_products p
    join public.commerce_preview_product_skus ps on ps.product_id=p.id
    where p.id=702
      and ps.sku='PTD200 COR BXB'
  ) then raise exception 'Expected preview Corações Product Master not found'; end if;

  if (
    select count(*)
    from public.commerce_source_rows sr
    join public.commerce_source_files sf on sf.id=sr.source_file_id
    where sf.source_code='GS_REFERENCIA'
      and sr.id=5200
      and sr.normalized_payload->>'sku'='PTD200 COR B B'
      and sr.normalized_payload->>'image_url'
          ='https://cnp30blob.blob.core.windows.net/cnp3files/555fa395b421d98f49db60d37801aa52cf1dc6547d209831275800053d1255dd.jpeg'
      and public.commerce_image_years_compatible(
        'PTD200 COR BXB',
        sr.normalized_payload->>'sku',
        sr.normalized_payload->>'product_name'
      )
  ) <> 1 then raise exception 'Expected live GS Corações source not found'; end if;

  if (
    select count(*)
    from public.commerce_preview_source_rows sr
    join public.commerce_preview_source_files sf on sf.id=sr.source_file_id
    where sf.source_code='GS_REFERENCIA'
      and sr.id=5200
      and sr.normalized_payload->>'sku'='PTD200 COR B B'
      and sr.normalized_payload->>'image_url'
          ='https://cnp30blob.blob.core.windows.net/cnp3files/555fa395b421d98f49db60d37801aa52cf1dc6547d209831275800053d1255dd.jpeg'
  ) <> 1 then raise exception 'Expected preview GS Corações source not found'; end if;
end
$assert$;

update public.commerce_products
set reference_image_url='https://cnp30blob.blob.core.windows.net/cnp3files/555fa395b421d98f49db60d37801aa52cf1dc6547d209831275800053d1255dd.jpeg',
    reference_image_source='GS_AUDITED_ALIAS',
    reference_image_sku='PTD200 COR B B',
    updated_at=now()
where id=702
  and reference_image_url is null;

update public.commerce_preview_products
set reference_image_url='https://cnp30blob.blob.core.windows.net/cnp3files/555fa395b421d98f49db60d37801aa52cf1dc6547d209831275800053d1255dd.jpeg',
    reference_image_source='GS_AUDITED_ALIAS',
    reference_image_sku='PTD200 COR B B',
    updated_at=now()
where id=702
  and reference_image_url is null;

do $verify$
begin
  if not exists (
    select 1 from public.commerce_products
    where id=702
      and reference_image_source='GS_AUDITED_ALIAS'
      and reference_image_sku='PTD200 COR B B'
  ) then raise exception 'Live Corações image not applied'; end if;

  if not exists (
    select 1 from public.commerce_preview_products
    where id=702
      and reference_image_source='GS_AUDITED_ALIAS'
      and reference_image_sku='PTD200 COR B B'
  ) then raise exception 'Preview Corações image not applied'; end if;
end
$verify$;
