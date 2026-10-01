CREATE TABLE IF NOT EXISTS mural_product_images (
  product_id INTEGER PRIMARY KEY,
  source_image_key TEXT NOT NULL,
  processed_image_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','review','approved','failed','stale')),
  processor TEXT,
  processor_version TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mural_product_images_status
  ON mural_product_images(status, updated_at DESC);

INSERT INTO mural_product_images (product_id, source_image_key, status)
SELECT id, image_key, 'pending'
FROM products
WHERE image_key IS NOT NULL
ON CONFLICT(product_id) DO NOTHING;
