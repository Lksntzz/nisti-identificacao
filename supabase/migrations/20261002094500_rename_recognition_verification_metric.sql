-- Preserve historical recognition logs while removing the retired Gemini-specific column name.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='recognition_events' AND column_name='gemini_ms'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='recognition_events' AND column_name='verification_ms'
  ) THEN
    ALTER TABLE public.recognition_events RENAME COLUMN gemini_ms TO verification_ms;
  END IF;
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
    total_ms, embedding_ms, vectorize_ms, local_cv_ms, reference_load_ms, verification_ms,
    retrieval_top1, retrieval_top1_code, retrieval_top2, retrieval_top2_code, retrieval_margin,
    candidate_count, verification_mode, accepted_by, model,
    retrieval_source, reused_candidates, pipeline_version, reference_candidate_count, vector_top_k,
    verifier_reason_code, verifier_evidence, operator_name, operator_id
  ) VALUES (
    v_id, v_created_at, v_day, v_kind,
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
    NULLIF(p_row->>'verification_ms', '')::BIGINT,
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
  IF v_inserted = 0 THEN RETURN TRUE; END IF;

  v_success := CASE WHEN v_kind='success' THEN 1 ELSE 0 END;
  v_unmatched := CASE WHEN v_kind='unmatched' THEN 1 ELSE 0 END;
  v_system_error := CASE WHEN v_kind='system_error' THEN 1 ELSE 0 END;
  v_embedding := CASE WHEN p_row->>'embedding_ms' IS NOT NULL THEN 1 ELSE 0 END;
  v_generation := CASE WHEN p_row->>'verification_ms' IS NOT NULL THEN 1 ELSE 0 END;

  INSERT INTO public.recognition_daily (
    day, attempts, successes, unmatched, system_errors,
    embedding_requests, generation_requests, total_ms,
    last_success_at, last_unmatched_at, last_error_at, last_error_message, updated_at
  ) VALUES (
    v_day,1,v_success,v_unmatched,v_system_error,
    v_embedding,v_generation,v_total_ms,
    CASE WHEN v_success=1 THEN v_created_at END,
    CASE WHEN v_unmatched=1 THEN v_created_at END,
    CASE WHEN v_system_error=1 THEN v_created_at END,
    CASE WHEN v_system_error=1 THEN v_error_message END,
    v_created_at
  )
  ON CONFLICT (day) DO UPDATE SET
    attempts=public.recognition_daily.attempts+1,
    successes=public.recognition_daily.successes+EXCLUDED.successes,
    unmatched=public.recognition_daily.unmatched+EXCLUDED.unmatched,
    system_errors=public.recognition_daily.system_errors+EXCLUDED.system_errors,
    embedding_requests=public.recognition_daily.embedding_requests+EXCLUDED.embedding_requests,
    generation_requests=public.recognition_daily.generation_requests+EXCLUDED.generation_requests,
    total_ms=public.recognition_daily.total_ms+EXCLUDED.total_ms,
    last_success_at=COALESCE(EXCLUDED.last_success_at,public.recognition_daily.last_success_at),
    last_unmatched_at=COALESCE(EXCLUDED.last_unmatched_at,public.recognition_daily.last_unmatched_at),
    last_error_at=COALESCE(EXCLUDED.last_error_at,public.recognition_daily.last_error_at),
    last_error_message=COALESCE(EXCLUDED.last_error_message,public.recognition_daily.last_error_message),
    updated_at=EXCLUDED.updated_at;

  RETURN TRUE;
END;
$$;
