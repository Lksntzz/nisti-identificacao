CREATE TABLE IF NOT EXISTS product_gtins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  gtin TEXT NOT NULL UNIQUE,
  gtin_type TEXT NOT NULL DEFAULT 'GTIN-13',
  source TEXT NOT NULL DEFAULT 'GS1',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  CHECK (length(gtin) = 13 AND gtin NOT GLOB '*[^0-9]*')
);

CREATE INDEX IF NOT EXISTS idx_product_gtins_product_active
  ON product_gtins(product_id, active);

CREATE INDEX IF NOT EXISTS idx_product_gtins_active_gtin
  ON product_gtins(active, gtin);
