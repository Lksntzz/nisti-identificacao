CREATE OR REPLACE FUNCTION public.nisti_upsert_push_subscription_v1(
  p_user_id text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_row public.push_subscriptions%ROWTYPE;
BEGIN
  IF NULLIF(BTRIM(p_endpoint),'') IS NULL
     OR NULLIF(BTRIM(p_p256dh),'') IS NULL
     OR NULLIF(BTRIM(p_auth),'') IS NULL THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  INSERT INTO public.push_subscriptions(user_id,endpoint,p256dh,auth,created_at,updated_at)
  VALUES(
    LEFT(COALESCE(NULLIF(BTRIM(p_user_id),''),'anonymous'),100),
    BTRIM(p_endpoint),BTRIM(p_p256dh),BTRIM(p_auth),now(),now()
  )
  ON CONFLICT(endpoint) DO UPDATE SET
    user_id=EXCLUDED.user_id,
    p256dh=EXCLUDED.p256dh,
    auth=EXCLUDED.auth,
    updated_at=now()
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('status','ok','id',v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_list_push_subscriptions_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',id,'endpoint',endpoint,'p256dh',p256dh,'auth',auth
  ) ORDER BY id),'[]'::jsonb)
  FROM public.push_subscriptions
$$;

REVOKE ALL ON FUNCTION public.nisti_upsert_push_subscription_v1(text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_list_push_subscriptions_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_upsert_push_subscription_v1(text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_list_push_subscriptions_v1() TO service_role;
