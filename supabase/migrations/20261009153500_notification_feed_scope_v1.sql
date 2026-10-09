-- Separate operator cover notices from administrative activities before applying LIMIT.
-- Keep the existing RPC signatures so deployed clients remain compatible.
CREATE OR REPLACE FUNCTION public.nisti_reserve_notifications_v1(
  p_user_id text, p_limit integer DEFAULT 50
)
RETURNS TABLE(
  id bigint, type text, capa_code text, product_id bigint, sku text,
  product_name text, variacao text, platform text, image_key text,
  created_at timestamptz, is_read boolean, read_at timestamptz
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $$
  SELECT n.id,n.type,n.capa_code,n.product_id,n.sku,n.product_name,
         n.variacao,n.platform,n.image_key,n.created_at,
         (r.read_at IS NOT NULL) AS is_read,r.read_at
  FROM public.notifications n
  LEFT JOIN public.notification_reads r
    ON r.notification_id=n.id
   AND r.user_id=LEFT(COALESCE(NULLIF(BTRIM(p_user_id),''),'anonymous'),100)
  WHERE CASE
    WHEN p_user_id='__admin_system__'
      THEN n.type<>'new_cover' AND LEFT(n.capa_code,7)='__SYS__'
    ELSE n.type='new_cover'
  END
  ORDER BY n.id DESC
  LIMIT GREATEST(1,LEAST(100,COALESCE(p_limit,50)));
$$;

CREATE OR REPLACE FUNCTION public.nisti_reserve_unread_notifications_v1(p_user_id text)
RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp
AS $$
  SELECT COUNT(*)::bigint
  FROM public.notifications n
  LEFT JOIN public.notification_reads r
    ON r.notification_id=n.id
   AND r.user_id=LEFT(COALESCE(NULLIF(BTRIM(p_user_id),''),'anonymous'),100)
  WHERE r.id IS NULL AND CASE
    WHEN p_user_id='__admin_system__'
      THEN n.type<>'new_cover' AND LEFT(n.capa_code,7)='__SYS__'
    ELSE n.type='new_cover'
  END;
$$;

REVOKE ALL ON FUNCTION public.nisti_reserve_notifications_v1(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_reserve_unread_notifications_v1(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_notifications_v1(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_unread_notifications_v1(text) TO service_role;
NOTIFY pgrst, 'reload schema';
