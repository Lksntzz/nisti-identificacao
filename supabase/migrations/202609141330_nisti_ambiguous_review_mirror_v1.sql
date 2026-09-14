-- NISTI ID — supervised ambiguous Top-1 review state.
-- D1 remains authoritative while SUPABASE_WRITE_MODE=mirror.
-- These tables preserve the exact candidate set and review-session hash so the
-- feature can be reconciled before relational authority moves to PostgreSQL.

CREATE TABLE IF NOT EXISTS public.scan_occurrence_candidates (
  occurrence_id BIGINT NOT NULL REFERENCES public.scan_occurrences(id) ON DELETE CASCADE,
  capa_code TEXT NOT NULL,
  candidate_rank INTEGER NOT NULL CHECK (candidate_rank > 0),
  retrieval_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  reference_id BIGINT,
  reference_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (occurrence_id, capa_code)
);

CREATE INDEX IF NOT EXISTS idx_scan_occurrence_candidates_occurrence_rank
  ON public.scan_occurrence_candidates(occurrence_id, candidate_rank ASC);

CREATE TABLE IF NOT EXISTS public.scan_occurrence_review_sessions (
  occurrence_id BIGINT PRIMARY KEY REFERENCES public.scan_occurrences(id) ON DELETE CASCADE,
  review_token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.scan_occurrence_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_occurrence_review_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.scan_occurrence_candidates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.scan_occurrence_review_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.scan_occurrence_candidates TO service_role;
GRANT ALL ON TABLE public.scan_occurrence_review_sessions TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mirror_ambiguous_review_state(
  p_occurrence_id BIGINT,
  p_candidates JSONB,
  p_session JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_occurrence_id BIGINT := p_occurrence_id;
BEGIN
  IF v_occurrence_id IS NULL OR v_occurrence_id <= 0 THEN
    RAISE EXCEPTION 'invalid occurrence id';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.scan_occurrences WHERE id = v_occurrence_id
  ) THEN
    RAISE EXCEPTION 'scan occurrence % must be mirrored before review state', v_occurrence_id;
  END IF;

  IF jsonb_typeof(COALESCE(p_candidates, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'p_candidates must be an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_candidates, '[]'::JSONB)) AS x(
      occurrence_id BIGINT,
      capa_code TEXT,
      candidate_rank INTEGER,
      retrieval_score DOUBLE PRECISION,
      reference_id BIGINT,
      reference_kind TEXT,
      created_at TIMESTAMPTZ
    )
    WHERE x.occurrence_id IS DISTINCT FROM v_occurrence_id
       OR NULLIF(BTRIM(x.capa_code), '') IS NULL
       OR x.candidate_rank IS NULL
       OR x.candidate_rank <= 0
  ) THEN
    RAISE EXCEPTION 'invalid ambiguous review candidate row';
  END IF;

  DELETE FROM public.scan_occurrence_candidates
  WHERE occurrence_id = v_occurrence_id;

  INSERT INTO public.scan_occurrence_candidates (
    occurrence_id,capa_code,candidate_rank,retrieval_score,reference_id,reference_kind,created_at
  )
  SELECT
    v_occurrence_id,
    UPPER(BTRIM(x.capa_code)),
    x.candidate_rank,
    COALESCE(x.retrieval_score, 0),
    x.reference_id,
    NULLIF(BTRIM(x.reference_kind), ''),
    COALESCE(x.created_at, now())
  FROM jsonb_to_recordset(COALESCE(p_candidates, '[]'::JSONB)) AS x(
    occurrence_id BIGINT,
    capa_code TEXT,
    candidate_rank INTEGER,
    retrieval_score DOUBLE PRECISION,
    reference_id BIGINT,
    reference_kind TEXT,
    created_at TIMESTAMPTZ
  );

  IF p_session IS NULL OR jsonb_typeof(p_session) = 'null' THEN
    DELETE FROM public.scan_occurrence_review_sessions
    WHERE occurrence_id = v_occurrence_id;
  ELSE
    IF NULLIF(BTRIM(p_session->>'review_token_hash'), '') IS NULL THEN
      RAISE EXCEPTION 'review token hash is required';
    END IF;
    IF NULLIF(p_session->>'occurrence_id', '')::BIGINT IS DISTINCT FROM v_occurrence_id THEN
      RAISE EXCEPTION 'review session occurrence mismatch';
    END IF;

    INSERT INTO public.scan_occurrence_review_sessions (
      occurrence_id,review_token_hash,created_at
    ) VALUES (
      v_occurrence_id,
      p_session->>'review_token_hash',
      COALESCE(NULLIF(p_session->>'created_at', '')::TIMESTAMPTZ, now())
    )
    ON CONFLICT (occurrence_id) DO UPDATE SET
      review_token_hash = EXCLUDED.review_token_hash,
      created_at = EXCLUDED.created_at;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_mirror_ambiguous_review_state(BIGINT, JSONB, JSONB)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_ambiguous_review_state(BIGINT, JSONB, JSONB)
TO service_role;
