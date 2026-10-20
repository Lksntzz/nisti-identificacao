-- NISTI Notificações: fila FIFO com 10 segundos por chamada.
-- Não altera catálogo, vendas, Mural ou tabelas legadas.
CREATE TABLE IF NOT EXISTS public.nisti_dispatch_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_key uuid NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('SHOPEE','MERCADO LIVRE','AMAZON')),
  action text NOT NULL CHECK (action IN ('RETIRAR_CAPA')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SHOWING','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  expires_at timestamptz,
  CONSTRAINT nisti_dispatch_valid_times CHECK (
    (status='PENDING' AND started_at IS NULL AND expires_at IS NULL)
    OR (status IN ('SHOWING','EXPIRED') AND started_at IS NOT NULL AND expires_at IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS nisti_dispatch_pending_fifo_idx ON public.nisti_dispatch_calls (id) WHERE status='PENDING';
CREATE INDEX IF NOT EXISTS nisti_dispatch_showing_idx ON public.nisti_dispatch_calls (expires_at) WHERE status='SHOWING';
ALTER TABLE public.nisti_dispatch_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nisti_dispatch_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.nisti_dispatch_calls TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.nisti_dispatch_calls_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.nisti_dispatch_monitor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  key_digest text NOT NULL CHECK (key_digest ~ '^[0-9a-f]{64}$'),
  paired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz
);
ALTER TABLE public.nisti_dispatch_monitor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nisti_dispatch_monitor FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.nisti_dispatch_monitor TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_pair_monitor_v1(p_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_monitor_digest' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.nisti_dispatch_monitor(singleton,key_digest,paired_at,last_seen_at)
  VALUES (true,p_digest,clock_timestamp(),NULL)
  ON CONFLICT (singleton) DO UPDATE
    SET key_digest=excluded.key_digest,paired_at=excluded.paired_at,last_seen_at=NULL;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_monitor_valid_v1(p_digest text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.nisti_dispatch_monitor
    WHERE singleton=true AND key_digest=p_digest
  );
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_enqueue_v1(p_platform text,p_action text,p_request_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_row public.nisti_dispatch_calls%ROWTYPE;
BEGIN
  IF p_platform NOT IN ('SHOPEE','MERCADO LIVRE','AMAZON')
     OR p_action IS DISTINCT FROM 'RETIRAR_CAPA'
     OR p_request_key IS NULL THEN
    RAISE EXCEPTION 'invalid_dispatch_request' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(2026, 1020);
  SELECT * INTO v_row FROM public.nisti_dispatch_calls WHERE request_key=p_request_key;
  IF v_row.id IS NULL THEN
    IF (SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='PENDING') >= 50 THEN
      RAISE EXCEPTION 'dispatch_queue_full' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.nisti_dispatch_calls(request_key,platform,action)
    VALUES(p_request_key,p_platform,p_action) RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object(
    'id',v_row.id,'platform',v_row.platform,'action',v_row.action,
    'status',v_row.status,'created_at',v_row.created_at
  );
END;
$$;

-- Somente o monitor pareado pode avançar o ponteiro.
-- A transação escolhe uma chamada por vez. Chamada não consumida fica PENDING.
CREATE OR REPLACE FUNCTION public.nisti_dispatch_next_v1(p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_call public.nisti_dispatch_calls%ROWTYPE;
  v_now timestamptz;
  v_pending integer;
BEGIN
  PERFORM pg_advisory_xact_lock(2026, 1020);
  IF NOT EXISTS (
    SELECT 1 FROM public.nisti_dispatch_monitor
    WHERE singleton=true AND key_digest=p_digest
  ) THEN
    RAISE EXCEPTION 'monitor_unauthorized' USING ERRCODE='42501';
  END IF;
  v_now := clock_timestamp();
  UPDATE public.nisti_dispatch_monitor SET last_seen_at=v_now WHERE singleton=true;
  UPDATE public.nisti_dispatch_calls SET status='EXPIRED'
    WHERE status='SHOWING' AND expires_at <= v_now;
  SELECT * INTO v_call FROM public.nisti_dispatch_calls
    WHERE status='SHOWING' ORDER BY id LIMIT 1;
  IF v_call.id IS NULL THEN
    SELECT * INTO v_call FROM public.nisti_dispatch_calls
      WHERE status='PENDING' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF v_call.id IS NOT NULL THEN
      UPDATE public.nisti_dispatch_calls
        SET status='SHOWING',started_at=v_now,expires_at=v_now+interval '10 seconds'
        WHERE id=v_call.id RETURNING * INTO v_call;
    END IF;
  END IF;
  SELECT count(*) INTO v_pending FROM public.nisti_dispatch_calls WHERE status='PENDING';
  RETURN jsonb_build_object(
    'call',CASE WHEN v_call.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_call.id,'platform',v_call.platform,'action',v_call.action,
      'started_at',v_call.started_at,'expires_at',v_call.expires_at
    ) END,
    'pending',v_pending,'duration_seconds',10,'server_time',v_now
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_status_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'pending',(SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='PENDING'),
    'showing',(SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='SHOWING' AND expires_at>clock_timestamp()),
    'today',(SELECT count(*) FROM public.nisti_dispatch_calls WHERE created_at>=date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
    'monitor_paired',(SELECT EXISTS(SELECT 1 FROM public.nisti_dispatch_monitor)),
    'monitor_last_seen',(SELECT last_seen_at FROM public.nisti_dispatch_monitor WHERE singleton=true),
    'recent',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
      SELECT id,platform,action,
      CASE WHEN status='SHOWING' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE status END AS status,
      created_at,started_at,expires_at
      FROM public.nisti_dispatch_calls ORDER BY id DESC LIMIT 15
    ) x)
  );
$$;

REVOKE ALL ON FUNCTION public.nisti_dispatch_pair_monitor_v1(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_monitor_valid_v1(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_enqueue_v1(text,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_next_v1(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_status_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_pair_monitor_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_monitor_valid_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_enqueue_v1(text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_next_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_status_v1() TO service_role;