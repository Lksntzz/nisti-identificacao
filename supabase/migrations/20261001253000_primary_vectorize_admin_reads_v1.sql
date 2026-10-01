CREATE OR REPLACE FUNCTION public.nisti_vectorize_reference_rows_v1(
  p_limit integer DEFAULT 200,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.reference_id),'[]'::jsonb)
  FROM (
    SELECT
      r.id AS reference_id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind,
      e.embedding_model,e.dimensions,e.embedding_json,e.updated_at
    FROM public.cover_visual_references r
    JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.active=1
    ORDER BY r.id ASC
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,200),500))
    OFFSET GREATEST(COALESCE(p_offset,0),0)
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_vectorize_reference_v1(p_reference_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT to_jsonb(x)
  FROM (
    SELECT
      r.id AS reference_id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind,
      e.embedding_model,e.dimensions,e.embedding_json,e.updated_at
    FROM public.cover_visual_references r
    JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.id=p_reference_id AND r.active=1
    LIMIT 1
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_active_reference_ids_for_product_v1(p_product_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(id ORDER BY id),'[]'::jsonb)
  FROM public.cover_visual_references
  WHERE source_product_id=p_product_id AND active=1
$$;

CREATE OR REPLACE FUNCTION public.nisti_vectorize_status_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'references',(SELECT count(*) FROM public.cover_visual_references WHERE active=1),
    'embeddings',(
      SELECT count(*)
      FROM public.cover_visual_references r
      JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
      WHERE r.active=1
    ),
    'covers',(
      SELECT count(DISTINCT r.capa_code)
      FROM public.cover_visual_references r
      JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
      WHERE r.active=1
    ),
    'platforms',(
      SELECT count(DISTINCT upper(BTRIM(platform)))
      FROM public.product_platforms
      WHERE BTRIM(COALESCE(platform,''))<>''
    )
  )
$$;

REVOKE ALL ON FUNCTION public.nisti_vectorize_reference_rows_v1(integer,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_vectorize_reference_v1(bigint)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_active_reference_ids_for_product_v1(bigint)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_vectorize_status_v1()
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_vectorize_reference_rows_v1(integer,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_vectorize_reference_v1(bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_active_reference_ids_for_product_v1(bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_vectorize_status_v1()
  TO service_role;
