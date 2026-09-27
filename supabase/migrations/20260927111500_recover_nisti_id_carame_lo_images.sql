-- Recover four Product Master images from Nisti ID.
--
-- Audited alias:
--   Commerce family CDISC = historical Nisti ID family CADISC.
-- The cover code CRM1..CRM4 and finish PXP match exactly.
-- Do not generalize this alias to other families/covers.

do $sequence$
declare
  seq_name text;
  max_id bigint;
begin
  foreach seq_name in array array[
    pg_get_serial_sequence('public.commerce_product_media_links','id'),
    pg_get_serial_sequence('public.commerce_preview_product_media_links','id')
  ]
  loop
    if seq_name is not null then
      if seq_name like '%preview%' then
        select coalesce(max(id),0) into max_id
        from public.commerce_preview_product_media_links;
      else
        select coalesce(max(id),0) into max_id
        from public.commerce_product_media_links;
      end if;

      perform setval(seq_name, greatest(max_id,1), max_id > 0);
    end if;
  end loop;
end
$sequence$;

with mapping(product_id,source_product_id,matched_sku,image_key) as (
  values
    (718::bigint,59::bigint,'CADISC_CRM1_PXP','products/59/ef75276f-ea56-4328-ad56-dc344173d94a'),
    (719::bigint,60::bigint,'CADISC_CRM2_PXP','products/60/149b62cd-f3e3-4971-9b78-ed52f1464227'),
    (720::bigint,61::bigint,'CADISC_CRM3_PXP','products/61/9bc60a35-2d9d-4339-befe-5f5231ff1e6d'),
    (721::bigint,62::bigint,'CADISC_CRM4_PXP','products/62/e5719a79-2e95-45de-8479-dd5af3c90389')
)
insert into public.commerce_product_media_links(
  product_id,source_kind,source_product_id,matched_sku,image_key
)
select product_id,'NISTI_ID',source_product_id,matched_sku,image_key
from mapping
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

with mapping(product_id,source_product_id,matched_sku,image_key) as (
  values
    (718::bigint,59::bigint,'CADISC_CRM1_PXP','products/59/ef75276f-ea56-4328-ad56-dc344173d94a'),
    (719::bigint,60::bigint,'CADISC_CRM2_PXP','products/60/149b62cd-f3e3-4971-9b78-ed52f1464227'),
    (720::bigint,61::bigint,'CADISC_CRM3_PXP','products/61/9bc60a35-2d9d-4339-befe-5f5231ff1e6d'),
    (721::bigint,62::bigint,'CADISC_CRM4_PXP','products/62/e5719a79-2e95-45de-8479-dd5af3c90389')
)
insert into public.commerce_preview_product_media_links(
  product_id,source_kind,source_product_id,matched_sku,image_key
)
select product_id,'NISTI_ID',source_product_id,matched_sku,image_key
from mapping
on conflict (product_id,source_kind) do update
set source_product_id=excluded.source_product_id,
    matched_sku=excluded.matched_sku,
    image_key=excluded.image_key,
    updated_at=now();

do $assert$
begin
  if (
    select count(*)
    from public.commerce_product_media_links
    where product_id in (718,719,720,721)
      and source_kind='NISTI_ID'
  ) <> 4 then
    raise exception 'Live CDISC/CADISC Nisti ID image mapping mismatch';
  end if;

  if (
    select count(*)
    from public.commerce_preview_product_media_links
    where product_id in (718,719,720,721)
      and source_kind='NISTI_ID'
  ) <> 4 then
    raise exception 'Preview CDISC/CADISC Nisti ID image mapping mismatch';
  end if;
end
$assert$;
