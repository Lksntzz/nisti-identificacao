-- NISTI Notificações v4: opções independentes e editáveis por plataforma.
-- Mantém as chamadas e o histórico; não modifica o catálogo de marketplaces.
CREATE TABLE IF NOT EXISTS public.nisti_dispatch_platform_options (
  platform text PRIMARY KEY,
  options jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(options)='array' AND jsonb_array_length(options)<=16),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT nisti_dispatch_options_platform_chk CHECK (platform IN (
    'SHOPEE','MERCADO LIVRE ANTIGO','MERCADO LIVRE NOVO','MERCADO LIVRE',
    'AMAZON','SHEIN','TIK TOK','MAGALU','KWAI','LOJA INTEGRADA'))
);
ALTER TABLE public.nisti_dispatch_platform_options ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nisti_dispatch_platform_options FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.nisti_dispatch_platform_options TO service_role;

INSERT INTO public.nisti_dispatch_platform_options (platform,options) VALUES
('SHOPEE','["Full","Empresa","Venda Direta","Shopee Flex","Flex Avulso","Turbo"]'::jsonb),
('MERCADO LIVRE ANTIGO','["Full","Empresa","Venda Direta","Mercado Flex","Flex Avulso","Turbo"]'::jsonb),
('MERCADO LIVRE NOVO','["Full","Empresa","Venda Direta","Mercado Flex","Flex Avulso","Turbo"]'::jsonb),
('MERCADO LIVRE','["Empresa","Venda Direta","Mercado Flex","Flex Avulso","Turbo"]'::jsonb),
('AMAZON','["Full","Empresa","Venda Direta","Amazon Same Day","Flex Avulso","Turbo"]'::jsonb),
('SHEIN','["Empresa","Venda Direta","Flex Avulso","Turbo"]'::jsonb),
('TIK TOK','["Empresa","Venda Direta","Flex Avulso","Turbo"]'::jsonb),
('MAGALU','["Empresa","Venda Direta","Magalu Vapt","Flex Avulso","Turbo"]'::jsonb),
('KWAI','["Empresa","Venda Direta","Flex Avulso","Turbo"]'::jsonb),
('LOJA INTEGRADA','["Empresa","Venda Direta","Loja Integrada Flex","Flex Avulso","Turbo"]'::jsonb)
ON CONFLICT (platform) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_options_v4()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT coalesce(jsonb_object_agg(platform,options),'{}'::jsonb)
  FROM public.nisti_dispatch_platform_options;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_save_options_v4(
  p_platform text,p_options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_item text;v_seen text[]:=ARRAY[]::text[];v_clean jsonb:='[]'::jsonb;
BEGIN
  IF p_platform IS NULL OR p_platform NOT IN (
    'SHOPEE','MERCADO LIVRE ANTIGO','MERCADO LIVRE NOVO','MERCADO LIVRE',
    'AMAZON','SHEIN','TIK TOK','MAGALU','KWAI','LOJA INTEGRADA')
    OR p_options IS NULL OR jsonb_typeof(p_options)<>'array'
    OR jsonb_array_length(p_options)>16 THEN
      RAISE EXCEPTION 'dispatch_options_invalid' USING ERRCODE='22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements_text(p_options) LOOP
    v_item:=btrim(v_item);
    IF length(v_item) NOT BETWEEN 1 AND 60
       OR v_item ~ '[[:cntrl:]]'
       OR upper(v_item)='RETIRAR CAPA'
       OR lower(v_item)=ANY(v_seen) THEN
      RAISE EXCEPTION 'dispatch_options_invalid' USING ERRCODE='22023';
    END IF;
    v_seen:=array_append(v_seen,lower(v_item));
    v_clean:=v_clean||jsonb_build_array(v_item);
  END LOOP;
  INSERT INTO public.nisti_dispatch_platform_options(platform,options,updated_at)
    VALUES(p_platform,v_clean,clock_timestamp())
  ON CONFLICT(platform) DO UPDATE SET options=excluded.options,updated_at=excluded.updated_at;
  RETURN jsonb_build_object('platform',p_platform,'options',v_clean);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dispatch_enqueue_batch_v4(p_calls jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_item jsonb;
  v_platform text;
  v_option text;
  v_message text;
  v_key uuid;
  v_seen text[]:=ARRAY[]::text[];
  v_options jsonb;
  v_new integer:=0;
  v_row public.nisti_dispatch_calls%ROWTYPE;
  v_result jsonb:='[]'::jsonb;
BEGIN
  IF p_calls IS NULL OR jsonb_typeof(p_calls)<>'array'
     OR jsonb_array_length(p_calls) NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(2026,1020);
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_calls) LOOP
    IF jsonb_typeof(v_item)<>'object' THEN
      RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
    END IF;
    v_platform:=v_item->>'platform';
    v_option:=btrim(coalesce(v_item->>'option',''));
    IF v_platform IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.nisti_dispatch_platform_options
      WHERE platform=v_platform
    ) OR v_platform=ANY(v_seen)
       OR length(v_option) NOT BETWEEN 1 AND 60 OR v_option ~ '[[:cntrl:]]'
       OR coalesce(v_item->>'request_key','') !~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
    END IF;
    SELECT options INTO v_options FROM public.nisti_dispatch_platform_options WHERE platform=v_platform;
    IF v_option<>'RETIRAR CAPA'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_options) AS x(value)
                       WHERE x.value=v_option) THEN
      RAISE EXCEPTION 'dispatch_option_not_allowed' USING ERRCODE='22023';
    END IF;
    -- Universal: RETIRAR CAPA. Modalidade: PLATAFORMA RETIRAR CAPA TIPO.
    -- Labels "Full Shopee"/"Full Mercado Livre Novo" terminam como FULL,
    -- sem repetir a identificação da plataforma na chamada.
    v_message:=CASE WHEN v_option='RETIRAR CAPA' THEN 'RETIRAR CAPA'
      ELSE v_platform||' RETIRAR CAPA '||(CASE WHEN upper(v_option)='FULL'
          OR upper(v_option) LIKE 'FULL %' THEN 'FULL' ELSE upper(v_option) END)
    END;
    IF length(v_message)>120 THEN
      RAISE EXCEPTION 'invalid_dispatch_batch' USING ERRCODE='22023';
    END IF;
    v_seen:=array_append(v_seen,v_platform);
    v_key:=(v_item->>'request_key')::uuid;
    SELECT * INTO v_row FROM public.nisti_dispatch_calls WHERE request_key=v_key;
    IF v_row.id IS NULL THEN v_new:=v_new+1;
    ELSIF v_row.platform IS DISTINCT FROM v_platform
       OR v_row.message IS DISTINCT FROM v_message THEN
      RAISE EXCEPTION 'dispatch_idempotency_conflict' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.nisti_dispatch_calls WHERE status='PENDING')+v_new>50 THEN
    RAISE EXCEPTION 'dispatch_queue_full' USING ERRCODE='22023';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_calls) LOOP
    v_platform:=v_item->>'platform';
    v_option:=btrim(v_item->>'option');
    v_message:=CASE WHEN v_option='RETIRAR CAPA' THEN 'RETIRAR CAPA'
      ELSE v_platform||' RETIRAR CAPA '||(CASE WHEN upper(v_option)='FULL'
          OR upper(v_option) LIKE 'FULL %' THEN 'FULL' ELSE upper(v_option) END)
    END;
    v_key:=(v_item->>'request_key')::uuid;
    SELECT * INTO v_row FROM public.nisti_dispatch_calls WHERE request_key=v_key;
    IF v_row.id IS NULL THEN
      INSERT INTO public.nisti_dispatch_calls(request_key,platform,action,message)
      VALUES(v_key,v_platform,'RETIRAR_CAPA',v_message)
      RETURNING * INTO v_row;
    END IF;
    v_result:=v_result||jsonb_build_array(jsonb_build_object(
      'id',v_row.id,'platform',v_row.platform,'message',v_row.message,
      'status',v_row.status,'created_at',v_row.created_at));
  END LOOP;
  RETURN jsonb_build_object('items',v_result,'duration_seconds',15);
END;
$$;
REVOKE ALL ON FUNCTION public.nisti_dispatch_options_v4() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_save_options_v4(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dispatch_enqueue_batch_v4(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_options_v4() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_save_options_v4(text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dispatch_enqueue_batch_v4(jsonb) TO service_role;
