-- NISTI expedição v7: pedido de reconexão solicitado pelo painel de envio.
-- O monitor continua livre de aprovação ADM. Apenas o painel autorizado
-- pode solicitar um novo carregamento da tela que estiver aberta.
ALTER TABLE public.nisti_dispatch_public_monitor
  ADD COLUMN IF NOT EXISTS reconnect_requested_at timestamptz;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_request_reconnect_v7()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_last_seen timestamptz;
  v_marker timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(2026,1020);
  INSERT INTO public.nisti_dispatch_public_monitor(singleton,last_seen_at,reconnect_requested_at)
    VALUES(true,clock_timestamp()-interval '1 day',clock_timestamp())
    ON CONFLICT(singleton) DO UPDATE
      SET reconnect_requested_at=clock_timestamp();
  SELECT last_seen_at,reconnect_requested_at
    INTO v_last_seen,v_marker
    FROM public.nisti_dispatch_public_monitor WHERE singleton=true;
  RETURN jsonb_build_object(
    'online',v_last_seen > clock_timestamp()-interval '15 seconds',
    'monitor_last_seen',v_last_seen,
    'reconnect_marker',v_marker
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_public_next_v7()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_feed jsonb;
  v_marker timestamptz;
BEGIN
  v_feed:=public.nisti_dispatch_public_next_v6();
  SELECT reconnect_requested_at INTO v_marker
    FROM public.nisti_dispatch_public_monitor WHERE singleton=true;
  RETURN v_feed || jsonb_build_object('reconnect_marker',v_marker);
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_dispatch_request_reconnect_v7() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_public_next_v7() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_request_reconnect_v7() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_public_next_v7() TO service_role;