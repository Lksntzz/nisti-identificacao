-- Re-synchronize the Mural derivative queue with every current product image.
-- Approved admin-upload PNGs are preserved; any old automatic/legacy derivative
-- is invalidated so it cannot keep serving a damaged white-cover cutout.

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

-- Products without an image must not keep an old derivative pointer.
UPDATE mural_product_images
SET
  processed_image_key = NULL,
  status = 'stale',
  processor = NULL,
  processor_version = NULL,
  reviewed_by = NULL,
  reviewed_at = NULL,
  error_message = NULL,
  updated_at = CURRENT_TIMESTAMP
WHERE product_id IN (
  SELECT id FROM products WHERE image_key IS NULL
);
