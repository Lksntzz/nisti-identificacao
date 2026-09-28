-- Recover eight audited legacy Product Master images from GS reference data.
--
-- Operator-approved rule: image freshness/year does not block reuse when the
-- underlying product/cover identity is known.
--
-- Audited mappings:
-- 668 AGPBNV              -> AGD242D TOAZ BXB   (Azul)
-- 669 AG23TO2DPP          -> AGD242D TORS BXB   (Rosa)
-- 670 2B-1Z5O-SXT5       -> AGD242D TORS BXB   (Rosa)
-- 671 AGNEG2302           -> PB24 BORD PXP      (Negócios Bordô)
-- 673 AGNEG2203           -> PB24 GRFT PXP      (Negócios Grafite)
-- 697 PB26_NEGAZ_PXP      -> PB24 AZU PXP       (NEG + AZ = Azul)
-- 699 PB26_NEGBD_PXP      -> PB24 BORD PXP      (NEG + BD = Bordô)
-- 701 CONFIN25 BRCO BBB   -> CONFIN BRCO BBB    (Controle Financeiro Branco)

do $assert_targets$
begin
  if (select count(*) from public.commerce_product_skus
      where (product_id=668 and sku='AGPBNV')
         or (product_id=669 and sku='AG23TO2DPP')
         or (product_id=670 and sku='2B-1Z5O-SXT5')
         or (product_id=671 and sku='AGNEG2302')
         or (product_id=673 and sku='AGNEG2203')
         or (product_id=697 and sku='PB26_NEGAZ_PXP')
         or (product_id=699 and sku='PB26_NEGBD_PXP')
         or (product_id=701 and sku='CONFIN25 BRCO BBB')
  ) <> 8 then
    raise exception 'Expected 8 audited Product Master SKUs';
  end if;
end
$assert_targets$;

with mappings(product_id,reference_sku,url) as (
  values
    (668::bigint,'AGD242D TOAZ BXB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/9fa75ae5072dc0aceeb60a4fff76042acd8be11d76adcf9cb30aa7169ecbc1e9.png'::text),
    (669::bigint,'AGD242D TORS BXB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/fb1ad631736477a5dfef01e2e72e629a1552ae99fcfc275851768f57d2c371ac.png'::text),
    (670::bigint,'AGD242D TORS BXB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/fb1ad631736477a5dfef01e2e72e629a1552ae99fcfc275851768f57d2c371ac.png'::text),
    (671::bigint,'PB24 BORD PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/ce7a4408cad7632fdbe20c69a72546548c9f9db27ea3f60db94a13cf6c957543.png'::text),
    (673::bigint,'PB24 GRFT PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/9fe6d10e3321335d8397071b50242bc7f52359704b924e560f3a649b8d75e07b.png'::text),
    (697::bigint,'PB24 AZU PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/8aafdbc82f2397051f2bdb7c781fd57127829882ba48992b86677cacde836be9.png'::text),
    (699::bigint,'PB24 BORD PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/ce7a4408cad7632fdbe20c69a72546548c9f9db27ea3f60db94a13cf6c957543.png'::text),
    (701::bigint,'CONFIN BRCO BBB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/c57b91b1b4f0bde639cd675bca21ad61e9b3fbc942f85f37464886a43a7f35cb.png'::text)
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source='GS_AUDITED_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

with mappings(product_id,reference_sku,url) as (
  values
    (668::bigint,'AGD242D TOAZ BXB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/9fa75ae5072dc0aceeb60a4fff76042acd8be11d76adcf9cb30aa7169ecbc1e9.png'::text),
    (669::bigint,'AGD242D TORS BXB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/fb1ad631736477a5dfef01e2e72e629a1552ae99fcfc275851768f57d2c371ac.png'::text),
    (670::bigint,'AGD242D TORS BXB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/fb1ad631736477a5dfef01e2e72e629a1552ae99fcfc275851768f57d2c371ac.png'::text),
    (671::bigint,'PB24 BORD PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/ce7a4408cad7632fdbe20c69a72546548c9f9db27ea3f60db94a13cf6c957543.png'::text),
    (673::bigint,'PB24 GRFT PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/9fe6d10e3321335d8397071b50242bc7f52359704b924e560f3a649b8d75e07b.png'::text),
    (697::bigint,'PB24 AZU PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/8aafdbc82f2397051f2bdb7c781fd57127829882ba48992b86677cacde836be9.png'::text),
    (699::bigint,'PB24 BORD PXP'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/ce7a4408cad7632fdbe20c69a72546548c9f9db27ea3f60db94a13cf6c957543.png'::text),
    (701::bigint,'CONFIN BRCO BBB'::text,'https://cnp30blob.blob.core.windows.net/cnp3files/c57b91b1b4f0bde639cd675bca21ad61e9b3fbc942f85f37464886a43a7f35cb.png'::text)
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source='GS_AUDITED_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and p.reference_image_url is null;

do $verify$
begin
  if (select count(*) from public.commerce_products
      where id in (668,669,670,671,673,697,699,701)
        and reference_image_source='GS_AUDITED_ALIAS'
        and reference_image_url is not null) <> 8 then
    raise exception 'Expected 8 live GS audited image recoveries';
  end if;

  if (select count(*) from public.commerce_preview_products
      where id in (668,669,670,671,673,697,699,701)
        and reference_image_source='GS_AUDITED_ALIAS'
        and reference_image_url is not null) <> 8 then
    raise exception 'Expected 8 preview GS audited image recoveries';
  end if;
end
$verify$;
