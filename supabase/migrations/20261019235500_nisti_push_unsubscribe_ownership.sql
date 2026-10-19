-- Segurança: o operador só pode remover a assinatura push associada
-- ao identificador de sessão que o Worker validou e forneceu.
-- Não modifica produtos, EANs, histórico, catálogo ou assinaturas existentes.
CREATE OR REPLACE FUNCTION public.nisti_delete_operator_push_subscription_v1(
  p_user_id text,
  p_endpoint text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF p_user_id IS NULL
     OR p_user_id !~* '^op_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR NULLIF(BTRIM(p_endpoint),'') IS NULL
     OR LENGTH(p_endpoint)>4096 THEN
    RETURN false;
  END IF;

  DELETE FROM public.push_subscriptions
   WHERE user_id = BTRIM(p_user_id)
     AND endpoint = BTRIM(p_endpoint);

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_delete_operator_push_subscription_v1(text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_delete_operator_push_subscription_v1(text,text)
  TO service_role;
