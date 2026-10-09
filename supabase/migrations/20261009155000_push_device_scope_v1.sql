-- Device-scoped push lookup. Only the Worker service role may access encryption keys.
CREATE OR REPLACE FUNCTION public.nisti_get_push_device_v1(p_user_id text, p_endpoint text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'endpoint', ps.endpoint,
    'p256dh', ps.p256dh,
    'auth', ps.auth
  )
  FROM public.push_subscriptions ps
  WHERE ps.user_id = LEFT(NULLIF(BTRIM(p_user_id), ''), 100)
    AND ps.endpoint = BTRIM(p_endpoint)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.nisti_get_push_device_v1(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_get_push_device_v1(text,text) TO service_role;
