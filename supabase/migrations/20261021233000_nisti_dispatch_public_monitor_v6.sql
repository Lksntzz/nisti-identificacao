-- NISTI Notificações v6: monitor de exibição livre, sem pareamento.
-- Somente o Worker utiliza estas funções com service_role.
-- A rota pública expõe apenas a próxima chamada, nunca o painel de envio.
-- Todos os monitores observam a MESMA chamada por 15 segundos (fila FIFO).

CREATE TABLE IF NOT EXISTS public.nisti_dispatch_public_monitor (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.nisti_dispatch_public_monitor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nisti_dispatch_public_monitor FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.nisti_dispatch_public_monitor TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_public_next_v6()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_call public.nisti_dispatch_calls%ROWTYPE;
  v_now timestamptz;
  v_pending integer;
BEGIN
  -- Mesma trava da fila original: leitores simultâneos não adiantam duas chamadas.
  PERFORM pg_advisory_xact_lock(2026,1020);
  v_now := clock_timestamp();
  INSERT INTO public.nisti_dispatch_public_monitor(singleton,last_seen_at)
    VALUES(true,v_now)
    ON CONFLICT(singleton) DO UPDATE SET last_seen_at=excluded.last_seen_at;

  UPDATE public.nisti_dispatch_calls SET status='EXPIRED'
    WHERE status='SHOWING' AND expires_at<=v_now;
  SELECT * INTO v_call FROM public.nisti_dispatch_calls
    WHERE status='SHOWING' AND expires_at>v_now
    ORDER BY id LIMIT 1;
  IF v_call.id IS NULL THEN
    SELECT * INTO v_call FROM public.nisti_dispatch_calls
      WHERE status='PENDING' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF v_call.id IS NOT NULL THEN
      UPDATE public.nisti_dispatch_calls
      SET status='SHOWING',started_at=v_now,expires_at=v_now+interval '15 seconds'
      WHERE id=v_call.id RETURNING * INTO v_call;
    END IF;
  END IF;
  SELECT count(*) INTO v_pending FROM public.nisti_dispatch_calls WHERE status='PENDING';
  RETURN jsonb_build_object(
    'call',CASE WHEN v_call.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id',v_call.id,'platform',v_call.platform,'action',v_call.action,
      'message',v_call.message,'started_at',v_call.started_at,
      'expires_at',v_call.expires_at
    ) END,
    'pending',v_pending,'duration_seconds',15,'server_time',v_now
  );
END;
$$;

-- Status de presença do monitor livre; não depende mais de chave/cookie.
CREATE OR REPLACE FUNCTION public.nisti_dispatch_status_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'pending',(SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='PENDING'),
    'showing',(SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='SHOWING' AND expires_at>clock_timestamp()),
    'today',(SELECT count(*) FROM public.nisti_dispatch_calls WHERE created_at>=
      date_trunc('day',clock_timestamp() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'),
    'monitor_paired',true,
    'monitor_last_seen',(SELECT last_seen_at FROM public.nisti_dispatch_public_monitor WHERE singleton=true),
    'recent',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
      SELECT id,platform,action,message,
      CASE WHEN status='SHOWING' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE status END AS status,
      created_at,started_at,expires_at
      FROM public.nisti_dispatch_calls ORDER BY id DESC LIMIT 15
    ) x)
  );
$$;

REVOKE ALL ON FUNCTION public.nisti_dispatch_public_next_v6() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_public_next_v6() TO service_role;
