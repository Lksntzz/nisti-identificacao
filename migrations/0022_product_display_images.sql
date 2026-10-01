-- Canonicalize the existing derivative table as the global product display-image queue.
-- The original source image remains in products.image_key. The processed PNG is stored
-- separately in mural_product_images.processed_image_key and can be regenerated safely.

CREATE INDEX IF NOT EXISTS idx_mural_product_images_source_status
  ON mural_product_images(source_image_key, status, updated_at DESC);

-- Guarantee every product with an original image has a derivative queue row.
INSERT INTO mural_product_images (
  product_id,
  source_image_key,
  processed_image_key,
  status,
  processor,
  processor_version,
  reviewed_by,
  reviewed_at,
  error_message,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.image_key,
  NULL,
  'pending',
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM products p
WHERE p.image_key IS NOT NULL
ON CONFLICT(product_id) DO UPDATE SET
  source_image_key = excluded.source_image_key,
  processed_image_key = CASE
    WHEN mural_product_images.status = 'approved'
      AND mural_product_images.processor = 'admin-upload'
      AND mural_product_images.source_image_key = excluded.source_image_key
    THEN mural_product_images.processed_image_key
    ELSE NULL
  END,
  status = CASE
    WHEN mural_product_images.status = 'approved'
      AND mural_product_images.processor = 'admin-upload'
      AND mural_product_images.source_image_key = excluded.source_image_key
    THEN 'approved'
    ELSE 'pending'
  END,
  processor = CASE
    WHEN mural_product_images.status = 'approved'
      AND mural_product_images.processor = 'admin-upload'
      AND mural_product_images.source_image_key = excluded.source_image_key
    THEN mural_product_images.processor
    ELSE NULL
  END,
  processor_version = CASE
    WHEN mural_product_images.status = 'approved'
      AND mural_product_images.processor = 'admin-upload'
      AND mural_product_images.source_image_key = excluded.source_image_key
    THEN mural_product_images.processor_version
    ELSE NULL
  END,
  reviewed_by = CASE
    WHEN mural_product_images.status = 'approved'
      AND mural_product_images.processor = 'admin-upload'
      AND mural_product_images.source_image_key = excluded.source_image_key
    THEN mural_product_images.reviewed_by
    ELSE NULL
  END,
  reviewed_at = CASE
    WHEN mural_product_images.status = 'approved'
      AND mural_product_images.processor = 'admin-upload'
      AND mural_product_images.source_image_key = excluded.source_image_key
    THEN mural_product_images.reviewed_at
    ELSE NULL
  END,
  error_message = NULL,
  updated_at = CURRENT_TIMESTAMP;

-- Keep the derivative queue synchronized at the database layer as an additional
-- safety net. Application code still removes stale R2 objects when replacing images.
CREATE TRIGGER IF NOT EXISTS trg_products_image_insert_derivative
AFTER INSERT ON products
WHEN NEW.image_key IS NOT NULL
BEGIN
  INSERT INTO mural_product_images (
    product_id,source_image_key,processed_image_key,status,processor,
    processor_version,reviewed_by,reviewed_at,error_message,created_at,updated_at
  ) VALUES (
    NEW.id,NEW.image_key,NULL,'pending',NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  )
  ON CONFLICT(product_id) DO UPDATE SET
    source_image_key=excluded.source_image_key,
    processed_image_key=NULL,
    status='pending',
    processor=NULL,
    processor_version=NULL,
    reviewed_by=NULL,
    reviewed_at=NULL,
    error_message=NULL,
    updated_at=CURRENT_TIMESTAMP;
END;

CREATE TRIGGER IF NOT EXISTS trg_products_image_update_derivative
AFTER UPDATE OF image_key ON products
WHEN NEW.image_key IS NOT OLD.image_key
BEGIN
  INSERT INTO mural_product_images (
    product_id,source_image_key,processed_image_key,status,processor,
    processor_version,reviewed_by,reviewed_at,error_message,created_at,updated_at
  ) VALUES (
    NEW.id,NEW.image_key,NULL,
    CASE WHEN NEW.image_key IS NULL THEN 'stale' ELSE 'pending' END,
    NULL,NULL,NULL,NULL,NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
  )
  ON CONFLICT(product_id) DO UPDATE SET
    source_image_key=excluded.source_image_key,
    processed_image_key=NULL,
    status=excluded.status,
    processor=NULL,
    processor_version=NULL,
    reviewed_by=NULL,
    reviewed_at=NULL,
    error_message=NULL,
    updated_at=CURRENT_TIMESTAMP;
END;
