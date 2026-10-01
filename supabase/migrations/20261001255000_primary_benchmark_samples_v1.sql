CREATE OR REPLACE FUNCTION public.nisti_benchmark_samples_v1(
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.occurrence_id DESC),'[]'::jsonb)
  FROM (
    SELECT
      o.id AS occurrence_id,
      o.image_key,
      o.platform,
      o.trained_capa_code,
      r.id AS reference_id,
      e.embedding_json
    FROM public.scan_occurrences o
    JOIN public.cover_visual_references r
      ON r.image_key=o.image_key
     AND upper(BTRIM(r.capa_code))=upper(BTRIM(o.trained_capa_code))
    JOIN public.cover_reference_embeddings e
      ON e.reference_id=r.id
    WHERE o.status='trained'
      AND o.trained_capa_code IS NOT NULL
      AND BTRIM(o.trained_capa_code)<>''
      AND o.platform IS NOT NULL
      AND BTRIM(o.platform)<>''
      AND r.active=1
    ORDER BY o.id DESC
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,100),1000))
    OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) x
$$;

REVOKE ALL ON FUNCTION public.nisti_benchmark_samples_v1(integer,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_benchmark_samples_v1(integer,integer)
  TO service_role;
