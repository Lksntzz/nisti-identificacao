-- Explicit GTIN mappings provided for the Caramelo caderno de discos catalog.
-- Resolve product_id by SKU so the migration is stable across environments.

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983072', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'CADISC_CRM1_PXP'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983089', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'CADISC_CRM2_PXP'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983096', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'CADISC_CRM3_PXP'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983102', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'CADISC_CRM4_PXP'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;
