alter table public.product_gtins
  drop constraint if exists product_gtins_source_check;

alter table public.product_gtins
  add constraint product_gtins_source_check
  check (source in ('GS1', 'NISTI'));

insert into public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
select id, '7898764983072', 'GTIN-13', 'NISTI', true, now()
from public.products where sku = 'CADISC_CRM1_PXP'
on conflict (gtin) do update set
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();

insert into public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
select id, '7898764983089', 'GTIN-13', 'NISTI', true, now()
from public.products where sku = 'CADISC_CRM2_PXP'
on conflict (gtin) do update set
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();

insert into public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
select id, '7898764983096', 'GTIN-13', 'NISTI', true, now()
from public.products where sku = 'CADISC_CRM3_PXP'
on conflict (gtin) do update set
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();

insert into public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
select id, '7898764983102', 'GTIN-13', 'NISTI', true, now()
from public.products where sku = 'CADISC_CRM4_PXP'
on conflict (gtin) do update set
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();
