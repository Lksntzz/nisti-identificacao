CREATE OR REPLACE FUNCTION public.nisti_product_mask_queue_v1(
  p_processor_version text DEFAULT '16',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      COALESCE(NULLIF(BTRIM(p_processor_version),''),'16') AS current_version,
      GREATEST(1,LEAST(COALESCE(p_limit,20),100)) AS page_limit,
      GREATEST(COALESCE(p_offset,0),0) AS page_offset
  ),
  base AS (
    SELECT
      p.id,p.sku,p.nome,p.wireo_code,p.tassel_code,p.image_key,
      mpi.status,mpi.source_image_key,mpi.mask_image_key,mpi.mask_processor_version
    FROM public.products p
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.image_key IS NOT NULL
      AND (
        mpi.mask_image_key IS NULL
        OR mpi.source_image_key IS DISTINCT FROM p.image_key
        OR COALESCE(mpi.mask_processor_version,'')<>(SELECT current_version FROM params)
      )
  ),
  paged AS (
    SELECT * FROM base
    ORDER BY id
    LIMIT (SELECT page_limit FROM params)
    OFFSET (SELECT page_offset FROM params)
  )
  SELECT jsonb_build_object(
    'total',(SELECT COUNT(*) FROM base),
    'limit',(SELECT page_limit FROM params),
    'offset',(SELECT page_offset FROM params),
    'items',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',id,'sku',sku,'nome',nome,
          'wireo_code',COALESCE(wireo_code,''),
          'tassel_code',COALESCE(tassel_code,'X'),
          'image_key',image_key,'status',status,
          'source_image_key',source_image_key,
          'mask_image_key',mask_image_key,
          'mask_processor_version',mask_processor_version
        ) ORDER BY id
      ) FROM paged
    ),'[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.nisti_product_mask_queue_v1(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_product_mask_queue_v1(text,integer,integer) TO service_role;
