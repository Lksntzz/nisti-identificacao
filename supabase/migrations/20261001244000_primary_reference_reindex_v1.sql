CREATE OR REPLACE FUNCTION public.nisti_pending_visual_references_v1(
  p_embedding_model text,
  p_dimensions integer,
  p_limit integer DEFAULT 8
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb)
  FROM (
    SELECT r.id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind
    FROM public.cover_visual_references r
    LEFT JOIN public.cover_reference_embeddings e
      ON e.reference_id=r.id
     AND e.dimensions=p_dimensions
     AND e.embedding_model=p_embedding_model
    WHERE r.active=1 AND e.reference_id IS NULL
    ORDER BY r.id
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,8),20))
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_count_pending_visual_references_v1(
  p_embedding_model text,
  p_dimensions integer
) RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT count(*)
  FROM public.cover_visual_references r
  LEFT JOIN public.cover_reference_embeddings e
    ON e.reference_id=r.id
   AND e.dimensions=p_dimensions
   AND e.embedding_model=p_embedding_model
  WHERE r.active=1 AND e.reference_id IS NULL
$$;

CREATE OR REPLACE FUNCTION public.nisti_upsert_reference_embedding_v1(
  p_reference_id bigint,
  p_embedding_model text,
  p_dimensions integer,
  p_embedding_json text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM public.cover_visual_references
    WHERE id=p_reference_id AND active=1
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.cover_reference_embeddings(
    reference_id,embedding_model,dimensions,embedding_json,updated_at
  ) VALUES(
    p_reference_id,p_embedding_model,p_dimensions,p_embedding_json,now()
  )
  ON CONFLICT(reference_id) DO UPDATE SET
    embedding_model=EXCLUDED.embedding_model,
    dimensions=EXCLUDED.dimensions,
    embedding_json=EXCLUDED.embedding_json,
    updated_at=now();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_pending_visual_references_v1(text,integer,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_count_pending_visual_references_v1(text,integer)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_upsert_reference_embedding_v1(bigint,text,integer,text)
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_pending_visual_references_v1(text,integer,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_count_pending_visual_references_v1(text,integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_upsert_reference_embedding_v1(bigint,text,integer,text)
  TO service_role;
