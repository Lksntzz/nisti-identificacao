-- Explicit GTIN mappings provided for the PB27 Madeira catalog.
-- Resolve product_id by SKU so the migration is stable across environments.

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983751', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'PB27_MADP_PXP'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983768', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'PB27_MADB_PXP'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983775', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'PB27_MADM_PXP'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;
