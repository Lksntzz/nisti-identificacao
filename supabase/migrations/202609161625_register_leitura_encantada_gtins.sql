INSERT INTO public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983300', 'GTIN-13', 'NISTI', true, now()
FROM public.products
WHERE sku = 'DIALE_LTE1_BBB'
ON CONFLICT (gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();

INSERT INTO public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983317', 'GTIN-13', 'NISTI', true, now()
FROM public.products
WHERE sku = 'DIALE_LTE2_BBB'
ON CONFLICT (gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();

INSERT INTO public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983324', 'GTIN-13', 'NISTI', true, now()
FROM public.products
WHERE sku = 'DIALE_LTE3_BBB'
ON CONFLICT (gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();
