-- Record the explicit NISTI GTIN mappings for the PB27 Madeira catalog.
-- Resolve product_id by SKU so the migration is stable across environments.

WITH mappings(sku, gtin) AS (
  VALUES
    ('PB27_MADP_PXP', '7898764983751'),
    ('PB27_MADB_PXP', '7898764983768'),
    ('PB27_MADM_PXP', '7898764983775')
)
INSERT INTO public.product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT p.id, m.gtin, 'GTIN-13', 'NISTI', true, now()
FROM mappings m
JOIN public.products p ON p.sku = m.sku
ON CONFLICT (gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = true,
  updated_at = now();
