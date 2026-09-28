-- Recover Product Master #679 from an exact official-site title match.
--
-- Target:
--   Product Master #679 / Amazon seller SKU 19-MFST-UK76
--   Amazon title: Caderno De Controle De Caixa
-- Official Nisti page:
--   Code CADCONCX01
--   Title: Caderno De Controle De Caixa
--
-- The Amazon seller SKU is platform-specific. The product title is an exact
-- match to the official Nisti product page, and neither side carries an
-- edition year or cover variant. No SKU is rewritten.

do $assert$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=679
      and s.sku='19-MFST-UK76'
      and p.name='Caderno De Controle De Caixa'
      and p.edition_year is null
  ) then raise exception 'Expected live Caderno De Controle De Caixa target not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    join public.commerce_source_files sf on sf.id=sr.source_file_id
    where sf.source_code='AMAZON_GESTAO'
      and sr.matched_product_id=679
      and sr.normalized_payload->>'sku'='19-MFST-UK76'
      and sr.normalized_payload->>'asin'='B09PYFGT74'
      and sr.normalized_payload->>'product_name'='Caderno De Controle De Caixa'
  ) then raise exception 'Expected Amazon exact-title evidence not found'; end if;
end
$assert$;

update public.commerce_products
set reference_image_url='https://cdn.awsli.com.br/600x450/2063/2063428/produto/123115381/c841944b4b.jpg',
    reference_image_source='NISTI_SITE_EXACT_TITLE_AMAZON_ALIAS',
    reference_image_sku='CADCONCX01',
    updated_at=now()
where id=679
  and (
    reference_image_url is null
    or reference_image_source='NISTI_SITE_EXACT_TITLE_AMAZON_ALIAS'
  );

update public.commerce_preview_products
set reference_image_url='https://cdn.awsli.com.br/600x450/2063/2063428/produto/123115381/c841944b4b.jpg',
    reference_image_source='NISTI_SITE_EXACT_TITLE_AMAZON_ALIAS',
    reference_image_sku='CADCONCX01',
    updated_at=now()
where id=679
  and (
    reference_image_url is null
    or reference_image_source='NISTI_SITE_EXACT_TITLE_AMAZON_ALIAS'
  );

do $verify$
begin
  if not exists (
    select 1 from public.commerce_products
    where id=679
      and reference_image_source='NISTI_SITE_EXACT_TITLE_AMAZON_ALIAS'
      and reference_image_sku='CADCONCX01'
      and reference_image_url='https://cdn.awsli.com.br/600x450/2063/2063428/produto/123115381/c841944b4b.jpg'
  ) then raise exception 'Live Caderno De Controle De Caixa image recovery failed'; end if;

  if not exists (
    select 1 from public.commerce_preview_products
    where id=679
      and reference_image_source='NISTI_SITE_EXACT_TITLE_AMAZON_ALIAS'
      and reference_image_sku='CADCONCX01'
      and reference_image_url='https://cdn.awsli.com.br/600x450/2063/2063428/produto/123115381/c841944b4b.jpg'
  ) then raise exception 'Preview Caderno De Controle De Caixa image recovery failed'; end if;
end
$verify$;
