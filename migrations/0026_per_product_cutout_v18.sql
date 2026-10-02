-- Manual-only treated image contract v18 for the D1 compatibility store.
-- Keep the stored derivative keys for rollback/audit, but make every
-- pre-v18 derivative ineligible for display until it is regenerated manually.

UPDATE mural_product_images
SET
  status='pending',
  reviewed_by=NULL,
  reviewed_at=NULL,
  error_message=NULL,
  updated_at=CURRENT_TIMESTAMP
WHERE processed_image_key IS NOT NULL
  AND COALESCE(processor_version,'') <> '18';
