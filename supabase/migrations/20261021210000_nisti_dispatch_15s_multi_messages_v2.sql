-- NISTI Notificações v2: chamadas independentes por plataforma e exibição por 15 segundos.
-- Migracão aditiva: preserva histórico, chaves de pareamento e a fila existente.
ALTER TABLE public.nisti_dispatch_calls
  ADD COLUMN IF NOT EXISTS message text NOT NULL DEFAULT 'RETIRAR CAPA';

ALTER TABLE public.nisti_dispatch_calls DROP CONSTRAINT IF EXISTS nisti_dispatch_calls_action_check;
ALTER TABLE public.nisti_dispatch_calls
  ADD CONSTRAINT nisti_dispatch_calls_action_check CHECK (action IN ('RETIRAR_CAPA','AVISO'));
ALTER TABLE public.nisti_dispatch_calls
  ADD CONSTRAINT nisti_dispatch_calls_message_check
  CHECK (length(trim(message)) BETWEEN 1 AND 120 AND message !~ '[[:cntrl:]]');

-- Insert de lote totalmente atômico: nenhuma plataforma é inserida parcialmente.
-- Cada request_key assegura idempotência mesmo após timeout/reenvio de rede.
CREATE OR REPLACE FUNCTION public.nisti_dispatch_enqueue_batch_v2(p_calls jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_platform text;
  v_message text;
  v_key uuid;
  v_seen text[] := ARRAY[]::text[];
  v_new integer := 0;
  v_row public.nisti_dispatch_calls%ROWTYPE;
  v_result jsonb := '[]'::jsonb;
BEGIN
  IF p_calls IS NULL OR jsonb_typeof(p_calls) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_calls) NOT BETWEEN 1 AND 3 THEN
    RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
  END IF;

  PERFORM pg_advisory_xact_lock(2026, 1020);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_calls) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
    END IF;
    v_platform := v_item->>'platform';
    v_message := trim(coalesce(v_item->>'message',''));
    IF v_platform IS NULL OR v_platform NOT IN ('SHOPEE','MERCADO LIVRE','AMAZON')
       OR v_platform = ANY(v_seen)
       OR length(v_message) NOT BETWEEN 1 AND 120
       OR v_message ~ '[[:cntrl:]]'
       OR coalesce(v_item->>'request_key','') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
    END IF;
    v_seen := array_append(v_seen,v_platform);
    v_key := (v_item->>'request_key')::uuid;
    SELECT * INTO v_row FROM public.nisti_dispatch_calls WHERE request_key=v_key;
    IF v_row.id IS NULL THEN
      v_new := v_new + 1;
    ELSIF v_row.platform IS DISTINCT FROM v_platform
          OR v_row.message IS DISTINCT FROM v_message THEN
      RAISE EXCEPTION 'dispatch_idempotency_conflict' USING ERRCODE='22023';
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='PENDING')+v_new > 50 THEN
    RAISE EXCEPTION 'dispatch_queue_full' USING ERRCODE='22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_calls) LOOP
    v_platform := v_item->>'platform';
    v_message := trim(v_item->>'message');
    v_key := (v_item->>'request_key')::uuid;
    SELECT * INTO v_row FROM public.nisti_dispatch_calls WHERE request_key=v_key;
    IF v_row.id IS NULL THEN
      INSERT INTO public.nisti_dispatch_calls(request_key,platform,action,message)
      VALUES (v_key,v_platform,CASE WHEN upper(v_message)='RETIRAR CAPA'
        THEN 'RETIRAR_CAPA' ELSE 'AVISO' END,v_message)
      RETURNING * INTO v_row;
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id',v_row.id,'platform',v_row.platform,'message',v_row.message,
      'status',v_row.status,'created_at',v_row.created_at
    ));
  END LOOP;
  RETURN jsonb_build_object('items',v_result,'duration_seconds',15);
END;
$$;

-- Mantém o RPC antigo como entrada do monitor; novo tempo afeta as próximas chamadas.
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
      SELECT id,platform,action,message,
      CASE WHEN status='SHOWING' AND expires_at<=clock_timestamp() THEN 'EXPIRED' ELSE status END AS status,
      created_at,started_at,expires_at
      FROM public.nisti_dispatch_calls ORDER BY id DESC LIMIT 15
    ) x)
  );
$$;

REVOKE ALL ON FUNCTION public.nisti_dispatch_enqueue_batch_v2(jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_enqueue_batch_v2(jsonb) TO service_role;
