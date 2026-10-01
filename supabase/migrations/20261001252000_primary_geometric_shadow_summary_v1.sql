CREATE OR REPLACE FUNCTION public.nisti_geometric_shadow_summary_rows_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'counts',jsonb_build_object(
      'total_rows',count(*)::bigint,
      'pending_rows',count(*) FILTER (WHERE confirmed_capa_code IS NULL)::bigint,
      'confirmed_rows',count(*) FILTER (WHERE confirmed_capa_code IS NOT NULL)::bigint
    ),
    'confirmed',COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id ASC)
      FROM (
        SELECT
          id,evidence_token,photo_sha256,platform,retrieval_fastpath_eligible,retrieval_capa_code,
          geometric_evaluated,geometric_eligible,geometric_capa_code,content_independent,
          same_content_reference_count,confirmed_capa_code,confirmation_source,confirmed_at,created_at
        FROM public.geometric_shadow_evidence
        WHERE confirmed_capa_code IS NOT NULL
        ORDER BY id ASC
        LIMIT 5000
      ) x
    ),'[]'::jsonb)
  )
  FROM public.geometric_shadow_evidence
$$;

REVOKE ALL ON FUNCTION public.nisti_geometric_shadow_summary_rows_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_geometric_shadow_summary_rows_v1()
  TO service_role;
