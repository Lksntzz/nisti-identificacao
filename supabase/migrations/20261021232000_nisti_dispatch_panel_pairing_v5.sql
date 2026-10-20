-- Monitor NISTI v5: autorização do quiosque pelo painel administrativo, sem digitar segredos no notebook.
-- Credenciais aleatórias de 256 bits ficam apenas em cookies HttpOnly no navegador.
-- Somente hashes SHA-256 são persistidos. A aprovação substitui o monitor ativo.
CREATE TABLE IF NOT EXISTS public.nisti_dispatch_pair_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_digest text NOT NULL UNIQUE CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','APPROVED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '10 minutes'),
  approved_at timestamptz
);
CREATE INDEX IF NOT EXISTS nisti_dispatch_pair_pending_idx
  ON public.nisti_dispatch_pair_requests(expires_at) WHERE state='PENDING';
ALTER TABLE public.nisti_dispatch_pair_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nisti_dispatch_pair_requests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.nisti_dispatch_pair_requests TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_request_pair_v5(p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_id uuid; v_expires timestamptz;
BEGIN
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_monitor_digest' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(2026,1030);
  -- Evita esgotar a fila com solicitações públicas não autorizadas.
  IF (SELECT count(*) FROM public.nisti_dispatch_pair_requests
      WHERE state='PENDING' AND expires_at > clock_timestamp()) >= 12 THEN
    RAISE EXCEPTION 'monitor_pairing_busy' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.nisti_dispatch_pair_requests(key_digest) VALUES(p_digest)
  ON CONFLICT(key_digest) DO NOTHING
  RETURNING id,expires_at INTO v_id,v_expires;
  IF v_id IS NULL THEN
    SELECT id,expires_at INTO v_id,v_expires FROM public.nisti_dispatch_pair_requests
    WHERE key_digest=p_digest AND state='PENDING' AND expires_at>clock_timestamp();
  END IF;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'monitor_pairing_expired' USING ERRCODE='P0001';
  END IF;
  RETURN jsonb_build_object('status','PENDING','code',upper(left(p_digest,6)),
    'expires_at',v_expires);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_pair_status_v5(p_digest text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'status',CASE
      WHEN q.state='APPROVED' AND m.key_digest=q.key_digest THEN 'APPROVED'
      WHEN q.state='PENDING' AND q.expires_at>clock_timestamp() THEN 'PENDING'
      ELSE 'EXPIRED' END,
    'code',CASE WHEN q.state='PENDING' AND q.expires_at>clock_timestamp()
      THEN upper(left(q.key_digest,6)) ELSE NULL END,
    'expires_at',q.expires_at
  )
  FROM public.nisti_dispatch_pair_requests q
  LEFT JOIN public.nisti_dispatch_monitor m ON m.singleton=true
  WHERE q.key_digest=p_digest;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_pair_pending_v5()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',q.id,'code',upper(left(q.key_digest,6)),
    'created_at',q.created_at,'expires_at',q.expires_at
  ) ORDER BY q.created_at DESC),'[]'::jsonb)
  FROM (SELECT id,key_digest,created_at,expires_at
        FROM public.nisti_dispatch_pair_requests
        WHERE state='PENDING' AND expires_at>clock_timestamp()
        ORDER BY created_at DESC LIMIT 12) q;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_approve_pair_v5(p_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_digest text;
BEGIN
  PERFORM pg_advisory_xact_lock(2026,1030);
  SELECT key_digest INTO v_digest FROM public.nisti_dispatch_pair_requests
  WHERE id=p_id AND state='PENDING' AND expires_at>clock_timestamp()
  FOR UPDATE;
  IF v_digest IS NULL THEN
    RAISE EXCEPTION 'monitor_pairing_expired' USING ERRCODE='P0001';
  END IF;
  INSERT INTO public.nisti_dispatch_monitor(singleton,key_digest,paired_at,last_seen_at)
  VALUES(true,v_digest,clock_timestamp(),NULL)
  ON CONFLICT(singleton) DO UPDATE SET
    key_digest=excluded.key_digest,paired_at=excluded.paired_at,last_seen_at=NULL;
  UPDATE public.nisti_dispatch_pair_requests
  SET state=CASE WHEN id=p_id THEN 'APPROVED' ELSE 'EXPIRED' END,
      approved_at=CASE WHEN id=p_id THEN clock_timestamp() ELSE NULL END
  WHERE state='PENDING';
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_dispatch_request_pair_v5(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_pair_status_v5(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_pair_pending_v5() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_approve_pair_v5(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_request_pair_v5(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_pair_status_v5(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_pair_pending_v5() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_approve_pair_v5(uuid) TO service_role;
