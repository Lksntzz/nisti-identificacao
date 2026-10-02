-- Requeue generated derivatives for contour v9 (tassel, white-cover and shadow fixes).
-- Explicit administrator uploads remain authoritative and are not overwritten.
UPDATE public.mural_product_images
SET processed_image_key = NULL,
    status = 'pending',
    processor = NULL,
    processor_version = NULL,
    reviewed_by = NULL,
    reviewed_at = NULL,
    error_message = NULL,
    updated_at = now()
WHERE NOT (
  status = 'approved'
  AND processor = 'admin-upload'
  AND reviewed_by = 'admin'
);
