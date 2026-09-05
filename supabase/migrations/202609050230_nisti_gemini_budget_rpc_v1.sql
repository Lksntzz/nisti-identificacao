-- NISTI ID — Gemini verifier budget on Supabase
-- Ephemeral operational state used by the Cloudflare Worker during/after D1 cutover.
-- This table is intentionally outside the authoritative 13-table migration snapshot.

CREATE TABLE IF NOT EXISTS public.gemini_call_budget (
  lane TEXT NOT NULL,
  window_minute BIGINT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lane, window_minute)
);

ALTER TABLE public.gemini_call_budget ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gemini_call_budget FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gemini_call_budget TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_gemini_budget(
  p_lane TEXT,
  p_window_minute BIGINT,
  p_limit INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  changed_rows INTEGER := 0;
BEGIN
  IF btrim(coalesce(p_lane, '')) = '' OR p_window_minute IS NULL OR coalesce(p_limit, 0) < 1 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.gemini_call_budget (lane, window_minute, used, updated_at)
  VALUES (btrim(p_lane), p_window_minute, 1, now())
  ON CONFLICT (lane, window_minute) DO UPDATE SET
    used = public.gemini_call_budget.used + 1,
    updated_at = now()
  WHERE public.gemini_call_budget.used < p_limit;

  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  -- Best-effort bounded retention. This state is not business data.
  IF random() < 0.02 THEN
    DELETE FROM public.gemini_call_budget
    WHERE window_minute < (p_window_minute - 120);
  END IF;

  RETURN changed_rows > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_reserve_gemini_budget(TEXT, BIGINT, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_gemini_budget(TEXT, BIGINT, INTEGER)
  TO service_role;
