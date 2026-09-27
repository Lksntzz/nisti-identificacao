-- Audited Nisti ID recoveries for legacy Safari/Astronauta Product Masters.
--
-- #402 CADMOSF:
--   Historical source data associates CADMOSF with the same Safari identity as
--   VACMNO_SFR_BVV. Nisti ID product #150 provides the verified image.
--
-- #678 CADVMOAT (Astronauta):
--   Mercado Livre Antigo Drive folder "Espaço" identifies CAPA 2 as
--   VACMNO_SP2_BAA. Visual review confirms CAPA 2 is the rocket/space artwork.
--   Nisti ID product #129 is VACMNO_SP2_BAA.
--
-- Never map #678 to VACMNO_URSAT_BBB / Nisti ID #4: that is Príncipe Urso.

begin;

delete from public.commerce_product_media_links
where product_id=678
  and source_kind='NISTI_ID'
  and source_product_id=4;

delete from public.commerce_preview_product_media_links
where product_id=678
  and source_kind='NISTI_ID'
  and source_product_id=4;

do $sequence$
declare
  live_seq text := pg_get_serial_sequence('public.commerce_product_media_links','id');
  preview_seq text := pg_get_serial_sequence('public.commerce_preview_product_media_links','id');
  max_id bigint;
begin
  if live_seq is not null then
    select coalesce(max(id),0) into max_id from public.commerce_product_media_links;
    perform setval(live_seq,greatest(max_id,1),max_id>0);
  end if;

  if preview_seq is not null then
    select coalesce(max(id),0) into max_id from public.commerce_preview_product_media_links;
    perform setval(preview_seq,greatest(max_id,1),max_id>0);
  end if;
end
$sequence$;

with mapping(product_id,source_product_id,matched_sku) as (
  values
    (402::bigint,150::bigint,'VACMNO_SFR_BVV'),
    (678::bigint,129::bigint,'VACMNO_SP2_BAA')
),
validated as (
  select m.product_id,p.id source_product_id,p.sku matched_sku,p.image_key
  from mapping m
  join public.products p
    on p.id=m.source_product_id
   and p.sku=m.matched_sku
  where p.image_key is not null
)
insert into public.commerce_product_media_links(
  product_id,source_kind,source_product_id,matched_sku,image_key
)
select product_id,'NISTI_ID',source_product_id,matched_sku,image_key
from validated
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

with mapping(product_id,source_product_id,matched_sku) as (
  values
    (402::bigint,150::bigint,'VACMNO_SFR_BVV'),
    (678::bigint,129::bigint,'VACMNO_SP2_BAA')
),
validated as (
  select m.product_id,p.id source_product_id,p.sku matched_sku,p.image_key
  from mapping m
  join public.products p
    on p.id=m.source_product_id
   and p.sku=m.matched_sku
  where p.image_key is not null
)
insert into public.commerce_preview_product_media_links(
  product_id,source_kind,source_product_id,matched_sku,image_key
)
select product_id,'NISTI_ID',source_product_id,matched_sku,image_key
from validated
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

do $assert$
begin
  if not exists (
    select 1 from public.commerce_product_media_links
    where product_id=402 and source_product_id=150 and matched_sku='VACMNO_SFR_BVV'
  ) then raise exception 'Live CADMOSF Safari mapping missing'; end if;

  if not exists (
    select 1 from public.commerce_product_media_links
    where product_id=678 and source_product_id=129 and matched_sku='VACMNO_SP2_BAA'
  ) then raise exception 'Live Astronauta mapping missing'; end if;

  if exists (
    select 1 from public.commerce_product_media_links
    where product_id=678 and source_product_id=4
  ) then raise exception 'Invalid live Astronauta/Principe Urso mapping exists'; end if;

  if not exists (
    select 1 from public.commerce_preview_product_media_links
    where product_id=402 and source_product_id=150 and matched_sku='VACMNO_SFR_BVV'
  ) then raise exception 'Preview CADMOSF Safari mapping missing'; end if;

  if not exists (
    select 1 from public.commerce_preview_product_media_links
    where product_id=678 and source_product_id=129 and matched_sku='VACMNO_SP2_BAA'
  ) then raise exception 'Preview Astronauta mapping missing'; end if;

  if exists (
    select 1 from public.commerce_preview_product_media_links
    where product_id=678 and source_product_id=4
  ) then raise exception 'Invalid preview Astronauta/Principe Urso mapping exists'; end if;
end
$assert$;

commit;
