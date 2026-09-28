-- Recover four audited Product Master images from authoritative Nisti sources.
--
-- Official Nisti site exact-code mappings:
--   #648 CADRMR02 -> Cabelinho Preto
--     https://www.nistiprint.com.br/produto/caderno-de-receitas-colecao-minhas-receitas-cabelinho-preto.html
--   #649 CADRMR04 -> Cabelinho Loiro
--     https://www.nistiprint.com.br/produto/caderno-de-receitas-colecao-minhas-receitas-cabelinho-loiro.html
--   #687 CADRMR05 -> Cabelinho Vermelho
--     https://www.nistiprint.com.br/produto/caderno-de-receitas-colecao-minhas-receitas-cabelinho-vermelho.html
--
-- GS exact color/year mapping:
--   #689 AGNEG2301 -> PB24 AZU PXP
--   Target title explicitly identifies Negocios Azul 2024; GS source is the
--   active 2024 Negocios Azul reference and passes commerce_image_years_compatible.
--
-- No Product Master SKU is rewritten.

do $assert_targets$
begin
  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=648 and s.sku='CADRMR02'
      and lower(p.name) like '%cabelinho preto%'
  ) then raise exception 'Expected live CADRMR02 target not found'; end if;

  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=649 and s.sku='CADRMR04'
      and lower(p.name) like '%cabelinho loiro%'
  ) then raise exception 'Expected live CADRMR04 target not found'; end if;

  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=687 and s.sku='CADRMR05'
      and lower(p.name) like '%cabelinho vermelho%'
  ) then raise exception 'Expected live CADRMR05 target not found'; end if;

  if not exists (
    select 1
    from public.commerce_products p
    join public.commerce_product_skus s on s.product_id=p.id
    where p.id=689 and s.sku='AGNEG2301'
      and p.edition_year=2024
      and lower(p.name) like '%negocios%'
      and lower(p.name) like '%azul%'
  ) then raise exception 'Expected live AGNEG2301 target not found'; end if;

  if not exists (
    select 1
    from public.commerce_source_rows sr
    join public.commerce_source_files sf on sf.id=sr.source_file_id
    where sf.source_code='GS_REFERENCIA'
      and sr.id=5162
      and sr.normalized_payload->>'sku'='PB24 AZU PXP'
      and sr.normalized_payload->>'status'='Ativo'
      and sr.normalized_payload->>'image_url'
        ='https://cnp30blob.blob.core.windows.net/cnp3files/8aafdbc82f2397051f2bdb7c781fd57127829882ba48992b86677cacde836be9.png'
      and public.commerce_image_years_compatible(
        'AGNEG2301',
        sr.normalized_payload->>'sku',
        sr.normalized_payload->>'product_name'
      )
  ) then raise exception 'Expected active GS Negocios Azul 2024 source not found'; end if;
end
$assert_targets$;

with mappings(product_id,source_kind,reference_sku,image_url) as (
  values
    (
      648::bigint,
      'NISTI_SITE_EXACT_CODE'::text,
      'CADRMR02'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/1215385702a39e1e4b8.jpg'::text
    ),
    (
      649::bigint,
      'NISTI_SITE_EXACT_CODE'::text,
      'CADRMR04'::text,
      'https://cdn.awsli.com.br/300x300/2063/2063428/produto/121538589d06680689b.jpg'::text
    ),
    (
      687::bigint,
      'NISTI_SITE_EXACT_CODE'::text,
      'CADRMR05'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/1215386095dc7b71acf.jpg'::text
    ),
    (
      689::bigint,
      'GS_EXACT_COLOR_YEAR'::text,
      'PB24 AZU PXP'::text,
      'https://cnp30blob.blob.core.windows.net/cnp3files/8aafdbc82f2397051f2bdb7c781fd57127829882ba48992b86677cacde836be9.png'::text
    )
)
update public.commerce_products p
set reference_image_url=m.image_url,
    reference_image_source=m.source_kind,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source=m.source_kind
  );

with mappings(product_id,source_kind,reference_sku,image_url) as (
  values
    (
      648::bigint,
      'NISTI_SITE_EXACT_CODE'::text,
      'CADRMR02'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/1215385702a39e1e4b8.jpg'::text
    ),
    (
      649::bigint,
      'NISTI_SITE_EXACT_CODE'::text,
      'CADRMR04'::text,
      'https://cdn.awsli.com.br/300x300/2063/2063428/produto/121538589d06680689b.jpg'::text
    ),
    (
      687::bigint,
      'NISTI_SITE_EXACT_CODE'::text,
      'CADRMR05'::text,
      'https://cdn.awsli.com.br/600x450/2063/2063428/produto/1215386095dc7b71acf.jpg'::text
    ),
    (
      689::bigint,
      'GS_EXACT_COLOR_YEAR'::text,
      'PB24 AZU PXP'::text,
      'https://cnp30blob.blob.core.windows.net/cnp3files/8aafdbc82f2397051f2bdb7c781fd57127829882ba48992b86677cacde836be9.png'::text
    )
)
update public.commerce_preview_products p
set reference_image_url=m.image_url,
    reference_image_source=m.source_kind,
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source=m.source_kind
  );

do $assert_result$
begin
  if (
    select count(*)
    from public.commerce_products
    where id in (648,649,687,689)
      and reference_image_url is not null
  ) <> 4 then
    raise exception 'Expected four live batch-5 image recoveries';
  end if;

  if (
    select count(*)
    from public.commerce_preview_products
    where id in (648,649,687,689)
      and reference_image_url is not null
  ) <> 4 then
    raise exception 'Expected four preview batch-5 image recoveries';
  end if;
end
$assert_result$;
