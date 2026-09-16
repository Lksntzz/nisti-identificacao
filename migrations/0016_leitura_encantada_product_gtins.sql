-- Explicit GTIN mappings for Caderno Diário de Leitura - Leitura Encantada.
-- Resolve product_id by SKU so the migration is stable across environments.

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983300', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'DIALE_LTE1_BBB'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983317', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'DIALE_LTE2_BBB'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO product_gtins (product_id, gtin, gtin_type, source, active, updated_at)
SELECT id, '7898764983324', 'GTIN-13', 'NISTI', 1, CURRENT_TIMESTAMP
FROM products
WHERE sku = 'DIALE_LTE3_BBB'
ON CONFLICT(gtin) DO UPDATE SET
  product_id = excluded.product_id,
  gtin_type = excluded.gtin_type,
  source = excluded.source,
  active = 1,
  updated_at = CURRENT_TIMESTAMP;
