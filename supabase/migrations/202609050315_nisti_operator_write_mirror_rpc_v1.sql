-- NISTI ID — transitional operator write mirror RPCs.
-- D1 remains authoritative while SUPABASE_WRITE_MODE=mirror.
-- Functions are idempotent where possible so retries do not double-count telemetry.

CREATE OR REPLACE FUNCTION public.nisti_mirror_scan_occurrence(p_row JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT := NULLIF(p_row->>'id', '')::BIGINT;
BEGIN
  IF v_id IS NULL OR btrim(coalesce(p_row->>'image_key', '')) = '' THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.scan_occurrences (
    id, image_key, platform, suggested_capa_code, confidence, error_reason,
    operator_name, operator_id, status, created_at
  ) VALUES (
    v_id,
    p_row->>'image_key',
    NULLIF(p_row->>'platform', ''),
    NULLIF(p_row->>'suggested_capa_code', ''),
    NULLIF(p_row->>'confidence', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'error_reason', ''),
    NULLIF(p_row->>'operator_name', ''),
    NULLIF(p_row->>'operator_id', ''),
    'pending',
    COALESCE(NULLIF(p_row->>'created_at', '')::TIMESTAMPTZ, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    image_key = EXCLUDED.image_key,
    platform = EXCLUDED.platform,
    suggested_capa_code = EXCLUDED.suggested_capa_code,
    confidence = EXCLUDED.confidence,
    error_reason = EXCLUDED.error_reason,
    operator_name = COALESCE(EXCLUDED.operator_name, public.scan_occurrences.operator_name),
    operator_id = COALESCE(EXCLUDED.operator_id, public.scan_occurrences.operator_id);

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_recognition_event(p_row JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT := NULLIF(p_row->>'id', '')::BIGINT;
  v_day TEXT := NULLIF(p_row->>'day', '');
  v_kind TEXT := NULLIF(p_row->>'kind', '');
  v_created_at TIMESTAMPTZ := COALESCE(NULLIF(p_row->>'created_at', '')::TIMESTAMPTZ, now());
  v_inserted INTEGER := 0;
  v_success INTEGER := 0;
  v_unmatched INTEGER := 0;
  v_system_error INTEGER := 0;
  v_embedding INTEGER := 0;
  v_generation INTEGER := 0;
  v_total_ms BIGINT := COALESCE(NULLIF(p_row->>'total_ms', '')::BIGINT, 0);
  v_error_message TEXT := NULLIF(p_row->>'error_message', '');
BEGIN
  IF v_id IS NULL OR v_day IS NULL OR v_kind NOT IN ('success', 'unmatched', 'system_error') THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.recognition_events (
    id, created_at, day, kind, http_status, product_id, capa_code, sku,
    confidence, retrieval_score, identified_by, error_message,
    total_ms, embedding_ms, vectorize_ms, local_cv_ms, reference_load_ms, gemini_ms,
    retrieval_top1, retrieval_top1_code, retrieval_top2, retrieval_top2_code, retrieval_margin,
    candidate_count, verification_mode, accepted_by, model,
    retrieval_source, reused_candidates, pipeline_version, reference_candidate_count, vector_top_k,
    verifier_reason_code, verifier_evidence, operator_name, operator_id
  ) VALUES (
    v_id,
    v_created_at,
    v_day,
    v_kind,
    COALESCE(NULLIF(p_row->>'http_status', '')::INTEGER, 0),
    NULLIF(p_row->>'product_id', '')::BIGINT,
    NULLIF(p_row->>'capa_code', ''),
    NULLIF(p_row->>'sku', ''),
    NULLIF(p_row->>'confidence', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'retrieval_score', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'identified_by', ''),
    v_error_message,
    v_total_ms,
    NULLIF(p_row->>'embedding_ms', '')::BIGINT,
    NULLIF(p_row->>'vectorize_ms', '')::BIGINT,
    NULLIF(p_row->>'local_cv_ms', '')::BIGINT,
    NULLIF(p_row->>'reference_load_ms', '')::BIGINT,
    NULLIF(p_row->>'gemini_ms', '')::BIGINT,
    NULLIF(p_row->>'retrieval_top1', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'retrieval_top1_code', ''),
    NULLIF(p_row->>'retrieval_top2', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'retrieval_top2_code', ''),
    NULLIF(p_row->>'retrieval_margin', '')::DOUBLE PRECISION,
    NULLIF(p_row->>'candidate_count', '')::INTEGER,
    NULLIF(p_row->>'verification_mode', ''),
    NULLIF(p_row->>'accepted_by', ''),
    NULLIF(p_row->>'model', ''),
    NULLIF(p_row->>'retrieval_source', ''),
    NULLIF(p_row->>'reused_candidates', '')::INTEGER,
    NULLIF(p_row->>'pipeline_version', ''),
    NULLIF(p_row->>'reference_candidate_count', '')::INTEGER,
    NULLIF(p_row->>'vector_top_k', '')::INTEGER,
    NULLIF(p_row->>'verifier_reason_code', ''),
    NULLIF(p_row->>'verifier_evidence', ''),
    NULLIF(p_row->>'operator_name', ''),
    NULLIF(p_row->>'operator_id', '')
  )
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN TRUE;
  END IF;

  v_success := CASE WHEN v_kind = 'success' THEN 1 ELSE 0 END;
  v_unmatched := CASE WHEN v_kind = 'unmatched' THEN 1 ELSE 0 END;
  v_system_error := CASE WHEN v_kind = 'system_error' THEN 1 ELSE 0 END;
  v_embedding := CASE WHEN p_row->>'embedding_ms' IS NOT NULL THEN 1 ELSE 0 END;
  v_generation := CASE WHEN p_row->>'gemini_ms' IS NOT NULL THEN 1 ELSE 0 END;

  INSERT INTO public.recognition_daily (
    day, attempts, successes, unmatched, system_errors,
    embedding_requests, generation_requests, total_ms,
    last_success_at, last_unmatched_at, last_error_at, last_error_message, updated_at
  ) VALUES (
    v_day, 1, v_success, v_unmatched, v_system_error,
    v_embedding, v_generation, v_total_ms,
    CASE WHEN v_success = 1 THEN v_created_at END,
    CASE WHEN v_unmatched = 1 THEN v_created_at END,
    CASE WHEN v_system_error = 1 THEN v_created_at END,
    CASE WHEN v_system_error = 1 THEN v_error_message END,
    v_created_at
  )
  ON CONFLICT (day) DO UPDATE SET
    attempts = public.recognition_daily.attempts + 1,
    successes = public.recognition_daily.successes + EXCLUDED.successes,
    unmatched = public.recognition_daily.unmatched + EXCLUDED.unmatched,
    system_errors = public.recognition_daily.system_errors + EXCLUDED.system_errors,
    embedding_requests = public.recognition_daily.embedding_requests + EXCLUDED.embedding_requests,
    generation_requests = public.recognition_daily.generation_requests + EXCLUDED.generation_requests,
    total_ms = public.recognition_daily.total_ms + EXCLUDED.total_ms,
    last_success_at = COALESCE(EXCLUDED.last_success_at, public.recognition_daily.last_success_at),
    last_unmatched_at = COALESCE(EXCLUDED.last_unmatched_at, public.recognition_daily.last_unmatched_at),
    last_error_at = COALESCE(EXCLUDED.last_error_at, public.recognition_daily.last_error_at),
    last_error_message = COALESCE(EXCLUDED.last_error_message, public.recognition_daily.last_error_message),
    updated_at = EXCLUDED.updated_at;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_geometric_shadow_evidence(p_row JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT := NULLIF(p_row->>'id', '')::BIGINT;
  v_token TEXT := NULLIF(p_row->>'evidence_token', '');
BEGIN
  IF v_id IS NULL OR v_token IS NULL THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.geometric_shadow_evidence (
    id, evidence_token, photo_sha256, platform, operator_id, operator_name, occurrence_id,
    shadow_version, gate_version, retrieval_fastpath_eligible, retrieval_capa_code,
    geometric_evaluated, geometric_eligible, geometric_capa_code,
    content_independent, same_content_reference_count, evidence_json, created_at, updated_at
  ) VALUES (
    v_id,
    v_token,
    p_row->>'photo_sha256',
    p_row->>'platform',
    NULLIF(p_row->>'operator_id', ''),
    NULLIF(p_row->>'operator_name', ''),
    NULLIF(p_row->>'occurrence_id', '')::BIGINT,
    COALESCE(NULLIF(p_row->>'shadow_version', ''), 'v8.18'),
    COALESCE(NULLIF(p_row->>'gate_version', ''), 'strict_core_v816'),
    COALESCE(NULLIF(p_row->>'retrieval_fastpath_eligible', '')::INTEGER, 0),
    NULLIF(p_row->>'retrieval_capa_code', ''),
    COALESCE(NULLIF(p_row->>'geometric_evaluated', '')::INTEGER, 0),
    COALESCE(NULLIF(p_row->>'geometric_eligible', '')::INTEGER, 0),
    NULLIF(p_row->>'geometric_capa_code', ''),
    COALESCE(NULLIF(p_row->>'content_independent', '')::INTEGER, 1),
    COALESCE(NULLIF(p_row->>'same_content_reference_count', '')::INTEGER, 0),
    p_row->>'evidence_json',
    COALESCE(NULLIF(p_row->>'created_at', '')::TIMESTAMPTZ, now()),
    COALESCE(NULLIF(p_row->>'updated_at', '')::TIMESTAMPTZ, now())
  )
  ON CONFLICT (evidence_token) DO UPDATE SET
    photo_sha256 = EXCLUDED.photo_sha256,
    platform = EXCLUDED.platform,
    operator_id = COALESCE(EXCLUDED.operator_id, public.geometric_shadow_evidence.operator_id),
    operator_name = COALESCE(EXCLUDED.operator_name, public.geometric_shadow_evidence.operator_name),
    occurrence_id = COALESCE(EXCLUDED.occurrence_id, public.geometric_shadow_evidence.occurrence_id),
    shadow_version = EXCLUDED.shadow_version,
    gate_version = EXCLUDED.gate_version,
    retrieval_fastpath_eligible = EXCLUDED.retrieval_fastpath_eligible,
    retrieval_capa_code = EXCLUDED.retrieval_capa_code,
    geometric_evaluated = EXCLUDED.geometric_evaluated,
    geometric_eligible = EXCLUDED.geometric_eligible,
    geometric_capa_code = EXCLUDED.geometric_capa_code,
    content_independent = EXCLUDED.content_independent,
    same_content_reference_count = EXCLUDED.same_content_reference_count,
    evidence_json = EXCLUDED.evidence_json,
    updated_at = EXCLUDED.updated_at;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_link_geometric_shadow(
  p_evidence_token TEXT,
  p_occurrence_id BIGINT,
  p_updated_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_changed BIGINT := 0;
BEGIN
  UPDATE public.geometric_shadow_evidence
  SET occurrence_id = p_occurrence_id, updated_at = p_updated_at
  WHERE evidence_token = p_evidence_token;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_confirm_geometric_shadow(
  p_occurrence_id BIGINT,
  p_photo_sha256 TEXT,
  p_capa_code TEXT,
  p_source TEXT,
  p_confirmed_at TIMESTAMPTZ DEFAULT now()
)
RETURNS BIGINT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_changed BIGINT := 0;
BEGIN
  IF btrim(coalesce(p_capa_code, '')) = '' OR (p_occurrence_id IS NULL AND btrim(coalesce(p_photo_sha256, '')) = '') THEN
    RETURN 0;
  END IF;

  IF p_occurrence_id IS NOT NULL THEN
    UPDATE public.geometric_shadow_evidence
    SET confirmed_capa_code = upper(btrim(p_capa_code)),
        confirmation_source = p_source,
        confirmed_at = p_confirmed_at,
        updated_at = p_confirmed_at
    WHERE occurrence_id = p_occurrence_id;
  ELSE
    UPDATE public.geometric_shadow_evidence
    SET confirmed_capa_code = upper(btrim(p_capa_code)),
        confirmation_source = p_source,
        confirmed_at = p_confirmed_at,
        updated_at = p_confirmed_at
    WHERE photo_sha256 = lower(btrim(p_photo_sha256));
  END IF;

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_mirror_scan_occurrence(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_recognition_event(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_geometric_shadow_evidence(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_link_geometric_shadow(TEXT, BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_confirm_geometric_shadow(BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_mirror_scan_occurrence(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_recognition_event(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_geometric_shadow_evidence(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_link_geometric_shadow(TEXT, BIGINT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_confirm_geometric_shadow(BIGINT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
