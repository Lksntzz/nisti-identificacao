CREATE OR REPLACE FUNCTION public.nisti_trained_references_v1(p_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC),'[]'::jsonb)
  FROM (
    SELECT
      r.id,r.capa_code,r.image_key,r.reference_kind,r.created_at,
      EXISTS(
        SELECT 1 FROM public.cover_reference_embeddings e WHERE e.reference_id=r.id
      ) AS is_indexed
    FROM public.cover_visual_references r
    WHERE r.active=1 AND r.reference_kind='real_scan'
    ORDER BY r.created_at DESC,r.id DESC
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,200),500))
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_cover_index_v1(
  p_embedding_model text,
  p_dimensions integer
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  WITH counts AS (
    SELECT
      (SELECT count(DISTINCT capa_code) FROM public.products WHERE image_key IS NOT NULL)::bigint AS reference_covers,
      (SELECT count(*) FROM public.cover_visual_references WHERE active=1)::bigint AS reference_images,
      (
        SELECT count(*)
        FROM public.cover_visual_references r
        JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
        WHERE r.active=1 AND e.dimensions=p_dimensions AND e.embedding_model=p_embedding_model
      )::bigint AS indexed_references,
      (
        SELECT count(DISTINCT r.capa_code)
        FROM public.cover_visual_references r
        JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
        WHERE r.active=1 AND e.dimensions=p_dimensions AND e.embedding_model=p_embedding_model
      )::bigint AS indexed_covers
  )
  SELECT jsonb_build_object(
    'reference_covers',reference_covers,
    'reference_images',reference_images,
    'indexed_references',indexed_references,
    'indexed_covers',indexed_covers,
    'pending_references',GREATEST(reference_images-indexed_references,0),
    'pending_covers',GREATEST(reference_images-indexed_references,0)
  )
  FROM counts
$$;

REVOKE ALL ON FUNCTION public.nisti_trained_references_v1(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_cover_index_v1(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_trained_references_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_cover_index_v1(text,integer) TO service_role;
