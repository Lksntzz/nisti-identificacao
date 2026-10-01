CREATE OR REPLACE FUNCTION public.nisti_geometric_shadow_by_token_v1(
  p_evidence_token text
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT to_jsonb(x)
  FROM (
    SELECT evidence_token,platform,evidence_json,confirmed_capa_code,
           occurrence_id,photo_sha256,confirmed_at
    FROM public.geometric_shadow_evidence
    WHERE evidence_token=p_evidence_token
    LIMIT 1
  ) x
$$;

REVOKE ALL ON FUNCTION public.nisti_geometric_shadow_by_token_v1(text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_geometric_shadow_by_token_v1(text)
  TO service_role;
