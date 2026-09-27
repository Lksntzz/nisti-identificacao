-- Recover audited Product Master images from Nisti ID and exact historical marketplace aliases.
-- All mappings in this batch were manually cross-checked against product names,
-- legacy/current SKU relationships, and artwork-year rules before being promoted.

-- 1) Nisti ID links: exact historical identity confirmed.
with mappings(product_id,source_product_id,matched_sku,image_key) as (
  values
    (402::bigint,150::bigint,'VACMNO_SFR_BVV','products/150/a36dd7d3-6f2a-47d5-9e7f-b8b6e2798900'),
    (678::bigint,4::bigint,'VACMNO_URSAT_BBB','products/4/2f5511a7-2071-4e77-be25-9b03299fd262')
),
numbered as (
  select m.*,
         (select coalesce(max(id),0) from public.commerce_product_media_links)
         + row_number() over(order by product_id) as new_id
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
    (402::bigint,150::bigint,'VACMNO_SFR_BVV','products/150/a36dd7d3-6f2a-47d5-9e7f-b8b6e2798900'),
    (678::bigint,4::bigint,'VACMNO_URSAT_BBB','products/4/2f5511a7-2071-4e77-be25-9b03299fd262')
),
numbered as (
  select m.*,
         (select coalesce(max(id),0) from public.commerce_preview_product_media_links)
         + row_number() over(order by product_id) as new_id
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

-- 2) Historical Shopee rows whose normalized product name matches the Product Master exactly.
with mappings(product_id,reference_sku,url) as (
  values
    (384::bigint,'PTD200 CMC B B','https://cf.shopee.com.br/file/br-11134207-81z1k-mepu7mj06mmb22'),
    (385::bigint,'PTD200 GARD BB','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljyzocha7'),
    (386::bigint,'PTD200 PER B B','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w0rvh6m0sxb2'),
    (387::bigint,'PDT200_ANOT_BXB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ovgw0u31ch99'),
    (388::bigint,'PTD200 ELE P P','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljyn18h72'),
    (389::bigint,'PTD200 CBLU PP','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljywv7l76'),
    (390::bigint,'PTD200 TRIA P P','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljyu22p58'),
    (391::bigint,'PTDVOV FLO BR','https://cf.shopee.com.br/file/br-11134207-7r98o-m8owbt8ozg8ya4'),
    (392::bigint,'CALIGR ATD BB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ethqr1zfgxe8'),
    (393::bigint,'CCAIXA CXA BB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181drhs412f'),
    (394::bigint,'CFTRNV_PED_BXB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ox6co5y29uaf'),
    (395::bigint,'CONFIN COL BB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8du61cdq4tt7f'),
    (396::bigint,'CONFIN MOE P P','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ox6co5v94yb7'),
    (397::bigint,'CONFIN GLO PP','https://cf.shopee.com.br/file/br-11134207-7r98o-m8dqd21lxfxt65'),
    (401::bigint,'VACMNASF','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181drar9tfd'),
    (404::bigint,'CADPED25_PABE_BXA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w9nehfcr3te6'),
    (439::bigint,'CADPED25 CONFIN25','https://cf.shopee.com.br/file/e3d970fa2e216ee7728d97d99df99e22'),
    (441::bigint,'CADKRAFT_PXP','https://cf.shopee.com.br/file/br-11134207-7r98o-maof9xr9jbaxed'),
    (472::bigint,'CARDSE PNJA BB','https://cf.shopee.com.br/file/br-11134207-7r98o-mdm5zg4zrohl32'),
    (475::bigint,'PNJPRO GLOB BXA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8gnb3oqhddd1e'),
    (493::bigint,'SCRABK_LOV_PXP','https://cf.shopee.com.br/file/6257a042d27ac939379d1d8768026c77'),
    (653::bigint,'CADKRAFT_PXP','https://cf.shopee.com.br/file/br-11134207-7r98o-maof9xr9jbaxed')
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source='SHOPEE_EXACT_NAME',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source='SHOPEE_EXACT_NAME'
  );

with mappings(product_id,reference_sku,url) as (
  values
    (384::bigint,'PTD200 CMC B B','https://cf.shopee.com.br/file/br-11134207-81z1k-mepu7mj06mmb22'),
    (385::bigint,'PTD200 GARD BB','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljyzocha7'),
    (386::bigint,'PTD200 PER B B','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w0rvh6m0sxb2'),
    (387::bigint,'PDT200_ANOT_BXB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ovgw0u31ch99'),
    (388::bigint,'PTD200 ELE P P','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljyn18h72'),
    (389::bigint,'PTD200 CBLU PP','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljywv7l76'),
    (390::bigint,'PTD200 TRIA P P','https://cf.shopee.com.br/file/br-11134207-81z1k-mepsrljyu22p58'),
    (391::bigint,'PTDVOV FLO BR','https://cf.shopee.com.br/file/br-11134207-7r98o-m8owbt8ozg8ya4'),
    (392::bigint,'CALIGR ATD BB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ethqr1zfgxe8'),
    (393::bigint,'CCAIXA CXA BB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181drhs412f'),
    (394::bigint,'CFTRNV_PED_BXB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ox6co5y29uaf'),
    (395::bigint,'CONFIN COL BB','https://cf.shopee.com.br/file/br-11134207-7r98o-m8du61cdq4tt7f'),
    (396::bigint,'CONFIN MOE P P','https://cf.shopee.com.br/file/br-11134207-7r98o-m8ox6co5v94yb7'),
    (397::bigint,'CONFIN GLO PP','https://cf.shopee.com.br/file/br-11134207-7r98o-m8dqd21lxfxt65'),
    (401::bigint,'VACMNASF','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w181drar9tfd'),
    (404::bigint,'CADPED25_PABE_BXA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8w9nehfcr3te6'),
    (439::bigint,'CADPED25 CONFIN25','https://cf.shopee.com.br/file/e3d970fa2e216ee7728d97d99df99e22'),
    (441::bigint,'CADKRAFT_PXP','https://cf.shopee.com.br/file/br-11134207-7r98o-maof9xr9jbaxed'),
    (472::bigint,'CARDSE PNJA BB','https://cf.shopee.com.br/file/br-11134207-7r98o-mdm5zg4zrohl32'),
    (475::bigint,'PNJPRO GLOB BXA','https://cf.shopee.com.br/file/br-11134207-7r98o-m8gnb3oqhddd1e'),
    (493::bigint,'SCRABK_LOV_PXP','https://cf.shopee.com.br/file/6257a042d27ac939379d1d8768026c77'),
    (653::bigint,'CADKRAFT_PXP','https://cf.shopee.com.br/file/br-11134207-7r98o-maof9xr9jbaxed')
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source='SHOPEE_EXACT_NAME',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source='SHOPEE_EXACT_NAME'
  );

-- 3) Explicit legacy -> current SKU aliases from the platform sheets.
with mappings(product_id,reference_sku,url) as (
  values
    (370::bigint,'CADMNA PTO BA','https://cf.shopee.com.br/file/sg-11134201-22110-9ejdjp08htjv7c'),
    (371::bigint,'CADMNO CP1 B B','https://cf.shopee.com.br/file/br-11134207-7r98o-m8vzxf592s29b1')
)
update public.commerce_products p
set reference_image_url=m.url,
    reference_image_source='SHOPEE_SKU_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source='SHOPEE_SKU_ALIAS'
  );

with mappings(product_id,reference_sku,url) as (
  values
    (370::bigint,'CADMNA PTO BA','https://cf.shopee.com.br/file/sg-11134201-22110-9ejdjp08htjv7c'),
    (371::bigint,'CADMNO CP1 B B','https://cf.shopee.com.br/file/br-11134207-7r98o-m8vzxf592s29b1')
)
update public.commerce_preview_products p
set reference_image_url=m.url,
    reference_image_source='SHOPEE_SKU_ALIAS',
    reference_image_sku=m.reference_sku,
    updated_at=now()
from mappings m
where p.id=m.product_id
  and (
    p.reference_image_url is null
    or p.reference_image_source='SHOPEE_SKU_ALIAS'
  );

do $assert$
begin
  if (select count(*) from public.commerce_product_media_links
      where product_id in (402,678) and source_kind='NISTI_ID') <> 2 then
    raise exception 'Expected two live Nisti ID recovery links';
  end if;

  if (select count(*) from public.commerce_preview_product_media_links
      where product_id in (402,678) and source_kind='NISTI_ID') <> 2 then
    raise exception 'Expected two preview Nisti ID recovery links';
  end if;

  if (select count(*) from public.commerce_products
      where id in (370,371,384,385,386,387,388,389,390,391,392,393,394,395,396,397,401,404,439,441,472,475,493,653)
        and reference_image_url is not null) <> 24 then
    raise exception 'Expected 24 live reference image recoveries';
  end if;

  if (select count(*) from public.commerce_preview_products
      where id in (370,371,384,385,386,387,388,389,390,391,392,393,394,395,396,397,401,404,439,441,472,475,493,653)
        and reference_image_url is not null) <> 24 then
    raise exception 'Expected 24 preview reference image recoveries';
  end if;
end
$assert$;
