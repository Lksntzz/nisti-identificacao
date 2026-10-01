-- NISTI reserve database — phase 1
-- Adds the product-image derivative state required by the current D1 schema.
-- Original product images remain referenced by products.image_key.

CREATE TABLE IF NOT EXISTS public.mural_product_images (
  product_id bigint PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  source_image_key text NOT NULL,
  processed_image_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','review','approved','failed','stale')),
  processor text,
  processor_version text,
  reviewed_by text,
  reviewed_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mural_product_images_status
  ON public.mural_product_images(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_mural_product_images_source
  ON public.mural_product_images(source_image_key, status, updated_at DESC);

ALTER TABLE public.mural_product_images ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mural_product_images FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mural_product_images TO service_role;

INSERT INTO public.mural_product_images (
  product_id, source_image_key, status, created_at, updated_at
)
SELECT p.id, p.image_key, 'pending', now(), now()
FROM public.products p
WHERE p.image_key IS NOT NULL
ON CONFLICT (product_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nisti_mirror_product_image(p_row jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_product_id bigint;
  v_source_image_key text;
BEGIN
  v_product_id := NULLIF(p_row->>'product_id','')::bigint;
  v_source_image_key := NULLIF(p_row->>'source_image_key','');

  IF v_product_id IS NULL OR v_source_image_key IS NULL THEN
    RAISE EXCEPTION 'product_id/source_image_key obrigatórios';
  END IF;

  INSERT INTO public.mural_product_images (
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
  ) VALUES (
    v_product_id,
    v_source_image_key,
    NULLIF(p_row->>'processed_image_key',''),
    COALESCE(NULLIF(p_row->>'status',''),'pending'),
    NULLIF(p_row->>'processor',''),
    NULLIF(p_row->>'processor_version',''),
    NULLIF(p_row->>'reviewed_by',''),
    NULLIF(p_row->>'reviewed_at','')::timestamptz,
    NULLIF(p_row->>'error_message',''),
    COALESCE(NULLIF(p_row->>'created_at','')::timestamptz, now()),
    COALESCE(NULLIF(p_row->>'updated_at','')::timestamptz, now())
  )
  ON CONFLICT (product_id) DO UPDATE SET
    source_image_key = EXCLUDED.source_image_key,
    processed_image_key = EXCLUDED.processed_image_key,
    status = EXCLUDED.status,
    processor = EXCLUDED.processor,
    processor_version = EXCLUDED.processor_version,
    reviewed_by = EXCLUDED.reviewed_by,
    reviewed_at = EXCLUDED.reviewed_at,
    error_message = EXCLUDED.error_message,
    updated_at = EXCLUDED.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_mirror_product_image(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_product_image(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_image_key(p_entity text, p_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  result_key text;
BEGIN
  CASE lower(btrim(coalesce(p_entity, '')))
    WHEN 'product' THEN
      SELECT p.image_key INTO result_key
      FROM public.products p
      WHERE p.id = p_id
      LIMIT 1;
    WHEN 'product-display' THEN
      SELECT CASE
        WHEN mpi.status='approved'
          AND mpi.processed_image_key IS NOT NULL
          AND mpi.source_image_key=p.image_key
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
      LIMIT 1;
    WHEN 'reference' THEN
      SELECT r.image_key INTO result_key
      FROM public.cover_visual_references r
      WHERE r.id = p_id AND r.active = 1
      LIMIT 1;
    WHEN 'occurrence' THEN
      SELECT o.image_key INTO result_key
      FROM public.scan_occurrences o
      WHERE o.id = p_id
      LIMIT 1;
    ELSE
      result_key := NULL;
  END CASE;
  RETURN result_key;
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_image_key(text,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_image_key(text,bigint) TO service_role;
