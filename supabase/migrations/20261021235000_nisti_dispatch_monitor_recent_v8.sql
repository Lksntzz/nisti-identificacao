-- Historico resumido para o monitor publico da expedicao.
-- Retorna somente ultimas 8 chamadas que chegaram a ser exibidas,
-- nunca notificacoes PENDING, chaves privadas, usuarios ou dados ADM.
CREATE OR REPLACE FUNCTION public.nisti_dispatch_public_next_v8()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_feed jsonb;
  v_recent jsonb;
BEGIN
  -- Mantem a mesma trava e transicao FIFO de 15 segundos de v6/v7.
  v_feed:=public.nisti_dispatch_public_next_v7();
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT id,platform,message,
      CASE WHEN status='SHOWING' AND expires_at<=clock_timestamp()
        THEN 'EXPIRED' ELSE status END AS status,
      started_at
    FROM public.nisti_dispatch_calls
    WHERE started_at IS NOT NULL AND status IN ('SHOWING','EXPIRED')
    ORDER BY id DESC LIMIT 8
  ) AS x;
  RETURN v_feed || jsonb_build_object('recent',v_recent);
END;
$$;
REVOKE ALL ON FUNCTION public.nisti_dispatch_public_next_v8() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_public_next_v8() TO service_role;
