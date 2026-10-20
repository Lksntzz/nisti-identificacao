-- NISTI Notificações v3: novas plataformas somente na fila de comunicação.
-- Os nomes comerciais do catálogo e relatórios permanecem inalterados.
ALTER TABLE public.nisti_dispatch_calls
  DROP CONSTRAINT IF EXISTS nisti_dispatch_calls_platform_check;
ALTER TABLE public.nisti_dispatch_calls
  ADD CONSTRAINT nisti_dispatch_calls_platform_check CHECK (platform IN (
    'SHOPEE','MERCADO LIVRE ANTIGO','MERCADO LIVRE NOVO','MERCADO LIVRE',
    'AMAZON','SHEIN','TIK TOK','MAGALU','KWAI','LOJA INTEGRADA'
  ));

-- Batch transacional, FIFO, até dez canais distintos, sem inserções parciais.
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
     OR jsonb_array_length(p_calls) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(2026, 1020);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_calls) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
    END IF;
    v_platform := v_item->>'platform';
    v_message := trim(coalesce(v_item->>'message',''));
    IF v_platform IS NULL OR v_platform NOT IN (
      'SHOPEE','MERCADO LIVRE ANTIGO','MERCADO LIVRE NOVO','MERCADO LIVRE',
      'AMAZON','SHEIN','TIK TOK','MAGALU','KWAI','LOJA INTEGRADA'
    ) OR v_platform = ANY(v_seen)
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

  IF (SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='PENDING') + v_new > 50 THEN
    RAISE EXCEPTION 'dispatch_queue_full' USING ERRCODE='22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_calls) LOOP
    v_platform := v_item->>'platform';
    v_message := trim(v_item->>'message');
    v_key := (v_item->>'request_key')::uuid;
    SELECT * INTO v_row FROM public.nisti_dispatch_calls WHERE request_key=v_key;
    IF v_row.id IS NULL THEN
      INSERT INTO public.nisti_dispatch_calls(request_key,platform,action,message)
      VALUES(v_key,v_platform,CASE WHEN upper(v_message)='RETIRAR CAPA'
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
REVOKE ALL ON FUNCTION public.nisti_dispatch_enqueue_batch_v2(jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_enqueue_batch_v2(jsonb) TO service_role;
