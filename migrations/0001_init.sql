CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  miolo_code TEXT NOT NULL,
  capa_code TEXT NOT NULL,
  acabamento_code TEXT NOT NULL,
  wireo_code TEXT NOT NULL,
  tassel_code TEXT NOT NULL,
  elastico_code TEXT NOT NULL,
  nome TEXT,
  variacao TEXT,
  image_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  platform TEXT NOT NULL,
  link TEXT,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_products_capa ON products(capa_code);
CREATE INDEX IF NOT EXISTS idx_products_finish ON products(wireo_code, tassel_code, elastico_code);
CREATE INDEX IF NOT EXISTS idx_platform_product ON product_platforms(product_id);
