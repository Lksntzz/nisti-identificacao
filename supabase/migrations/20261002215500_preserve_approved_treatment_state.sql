-- Approval is a durable editorial decision.
-- A processor release must never reopen an image that an admin already approved.
-- Only an explicit redo action or a changed source image invalidates the approved derivative.

CREATE OR REPLACE FUNCTION public.nisti_image_key(p_entity text, p_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  result_key text;
BEGIN
  CASE lower(btrim(coalesce(p_entity,'')))
    WHEN 'product' THEN
      SELECT p.image_key INTO result_key
      FROM public.products p
      WHERE p.id=p_id
      LIMIT 1;
    WHEN 'product-display' THEN
      SELECT CASE
        WHEN mpi.status='approved'
          AND mpi.processed_image_key IS NOT NULL
          AND mpi.source_image_key=p.image_key
          AND mpi.reviewed_by='admin'
        THEN mpi.processed_image_key
        ELSE p.image_key
      END
      INTO result_key
      FROM public.products p
      LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
      WHERE p.id=p_id
      LIMIT 1;
    WHEN 'mural-product' THEN
      SELECT mpi.processed_image_key INTO result_key
      FROM public.mural_product_images mpi
      INNER JOIN public.products p ON p.id=mpi.product_id
      WHERE mpi.product_id=p_id
        AND mpi.status='approved'
        AND mpi.processed_image_key IS NOT NULL
        AND mpi.source_image_key=p.image_key
        AND mpi.reviewed_by='admin'
      LIMIT 1;
    ELSE
      result_key := NULL;
  END CASE;
  RETURN result_key;
END;
$function$;
