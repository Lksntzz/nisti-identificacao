-- NISTI ID — scan occurrence state mirror v2
-- Corrige o mirror para preservar o estado autoritativo completo do D1.

CREATE OR REPLACE FUNCTION public.nisti_mirror_scan_occurrence(p_row JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT := NULLIF(p_row->>'id', '')::BIGINT;
  v_status TEXT := COALESCE(NULLIF(p_row->>'status', ''), 'pending');
BEGIN
  IF v_id IS NULL OR btrim(coalesce(p_row->>'image_key', '')) = '' THEN
    RETURN FALSE;
  END IF;

  IF v_status NOT IN ('pending', 'trained', 'dismissed') THEN
    RAISE EXCEPTION 'invalid scan occurrence status: %', v_status
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.scan_occurrences (
    id,
    image_key,
    platform,
    suggested_capa_code,
    confidence,
    error_reason,
    operator_name,
    operator_id,
    status,
    trained_capa_code,
    trained_at,
    created_at
  ) VALUES (
    v_id,
    p_row->>'image_key',
    NULLIF(p_row->>'platform', ''),
    NULLIF(p_row->>'suggested_capa_code', ''),
    NULLIF(p_row->>'confidence', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'error_reason', ''),
    NULLIF(p_row->>'operator_name', ''),
    NULLIF(p_row->>'operator_id', ''),
    v_status,
    NULLIF(p_row->>'trained_capa_code', ''),
    NULLIF(p_row->>'trained_at', '')::TIMESTAMPTZ,
    COALESCE(NULLIF(p_row->>'created_at', '')::TIMESTAMPTZ, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    image_key = EXCLUDED.image_key,
    platform = EXCLUDED.platform,
    suggested_capa_code = EXCLUDED.suggested_capa_code,
    confidence = EXCLUDED.confidence,
    error_reason = EXCLUDED.error_reason,
    operator_name = COALESCE(EXCLUDED.operator_name, public.scan_occurrences.operator_name),
    operator_id = COALESCE(EXCLUDED.operator_id, public.scan_occurrences.operator_id),
    status = EXCLUDED.status,
    trained_capa_code = EXCLUDED.trained_capa_code,
    trained_at = EXCLUDED.trained_at;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_mirror_scan_occurrence(JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_mirror_scan_occurrence(JSONB)
TO service_role;
