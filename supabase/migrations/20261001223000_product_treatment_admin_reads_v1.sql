CREATE OR REPLACE FUNCTION public.nisti_product_treatment_summary_v1(
  p_processor_version text DEFAULT '8'
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  WITH treatment_state AS (
    SELECT
      p.image_key,
      (
        p.image_key IS NOT NULL
        AND mpi.status='approved'
        AND mpi.processed_image_key IS NOT NULL
        AND mpi.source_image_key=p.image_key
        AND mpi.reviewed_by='admin'
      ) AS is_approved,
      (
        p.image_key IS NOT NULL
        AND (
          mpi.status='review'
          OR (mpi.status='approved' AND COALESCE(mpi.reviewed_by,'')<>'admin')
        )
        AND mpi.processed_image_key IS NOT NULL
        AND mpi.source_image_key=p.image_key
        AND COALESCE(mpi.processor_version,'')=COALESCE(NULLIF(BTRIM(p_processor_version),''),'8')
      ) AS is_review,
      (
        p.image_key IS NOT NULL
        AND mpi.status='failed'
        AND mpi.source_image_key=p.image_key
        AND COALESCE(mpi.processor_version,'')=COALESCE(NULLIF(BTRIM(p_processor_version),''),'8')
      ) AS is_failed
    FROM public.products p
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
  )
  SELECT jsonb_build_object(
    'with_image', COUNT(*) FILTER (WHERE image_key IS NOT NULL),
    'approved', COUNT(*) FILTER (WHERE is_approved),
    'review', COUNT(*) FILTER (WHERE is_review),
    'failed', COUNT(*) FILTER (WHERE is_failed),
    'pending', COUNT(*) FILTER (
      WHERE image_key IS NOT NULL
        AND NOT is_approved
        AND NOT is_review
        AND NOT is_failed
    )
  )
  FROM treatment_state
$$;

CREATE OR REPLACE FUNCTION public.nisti_product_treatment_queue_v1(
  p_status text DEFAULT 'work',
  p_processor_version text DEFAULT '8',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      CASE
        WHEN LOWER(BTRIM(COALESCE(p_status,'work'))) IN ('work','pending','review','stale','failed')
          THEN LOWER(BTRIM(COALESCE(p_status,'work')))
        ELSE 'work'
      END AS wanted_status,
      COALESCE(NULLIF(BTRIM(p_processor_version),''),'8') AS current_version,
      GREATEST(1,LEAST(COALESCE(p_limit,20),100)) AS page_limit,
      GREATEST(COALESCE(p_offset,0),0) AS page_offset
  ),
  base AS (
    SELECT
      p.id,p.sku,p.nome,p.image_key,p.tassel_code,
      mpi.source_image_key,mpi.processed_image_key,mpi.status,
      mpi.processor,mpi.processor_version,mpi.reviewed_by,mpi.error_message,
      CASE
        WHEN mpi.product_id IS NULL THEN 'pending'
        WHEN mpi.source_image_key IS DISTINCT FROM p.image_key THEN 'stale'
        WHEN mpi.status='stale' THEN 'stale'
        WHEN COALESCE(mpi.reviewed_by,'')<>'admin'
          AND COALESCE(mpi.processor_version,'')<>''
          AND COALESCE(mpi.processor_version,'')<>(SELECT current_version FROM params)
          THEN 'stale'
        WHEN (
          mpi.status='review'
          OR (mpi.status='approved' AND COALESCE(mpi.reviewed_by,'')<>'admin')
        )
          AND mpi.processed_image_key IS NOT NULL
          AND mpi.source_image_key=p.image_key
          AND COALESCE(mpi.processor_version,'')=(SELECT current_version FROM params)
          THEN 'review'
        WHEN mpi.status='failed'
          AND mpi.source_image_key=p.image_key
          AND COALESCE(mpi.processor_version,'')=(SELECT current_version FROM params)
          THEN 'failed'
        WHEN mpi.status='approved'
          AND mpi.processed_image_key IS NOT NULL
          AND mpi.source_image_key=p.image_key
          AND mpi.reviewed_by='admin'
          THEN 'approved'
        ELSE 'pending'
      END AS queue_status
    FROM public.products p
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.image_key IS NOT NULL
  ),
  filtered AS (
    SELECT *
    FROM base
    WHERE
      (
        (SELECT wanted_status FROM params)='work'
        AND queue_status IN ('pending','stale')
      )
      OR queue_status=(SELECT wanted_status FROM params)
  ),
  page AS (
    SELECT *
    FROM filtered
    ORDER BY
      CASE queue_status
        WHEN 'pending' THEN 0
        WHEN 'review' THEN 1
        WHEN 'stale' THEN 2
        WHEN 'failed' THEN 3
        ELSE 4
      END,
      id ASC
    LIMIT (SELECT page_limit FROM params)
    OFFSET (SELECT page_offset FROM params)
  )
  SELECT jsonb_build_object(
    'status',(SELECT wanted_status FROM params),
    'total',(SELECT COUNT(*) FROM filtered),
    'limit',(SELECT page_limit FROM params),
    'offset',(SELECT page_offset FROM params),
    'items',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',id,
          'sku',sku,
          'name',nome,
          'image_key',image_key,
          'tassel_code',COALESCE(tassel_code,'X'),
          'source_image_key',source_image_key,
          'processed_image_key',processed_image_key,
          'status',COALESCE(status,queue_status),
          'queue_status',queue_status,
          'processor',processor,
          'processor_version',processor_version,
          'reviewed_by',reviewed_by,
          'error_message',error_message
        )
        ORDER BY
          CASE queue_status
            WHEN 'pending' THEN 0
            WHEN 'review' THEN 1
            WHEN 'stale' THEN 2
            WHEN 'failed' THEN 3
            ELSE 4
          END,
          id ASC
      )
      FROM page
    ),'[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.nisti_product_treatment_summary_v1(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_product_treatment_queue_v1(text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_product_treatment_summary_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_product_treatment_queue_v1(text,text,integer,integer) TO service_role;
