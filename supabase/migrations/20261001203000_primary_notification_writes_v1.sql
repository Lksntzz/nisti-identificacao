CREATE OR REPLACE FUNCTION public.nisti_record_new_cover_notification_v1(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_code text := upper(NULLIF(btrim(p_row->>'capa_code'),'')); v_id bigint; v_created boolean := false;
BEGIN
  IF v_code IS NULL THEN RETURN jsonb_build_object('status','invalid'); END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE upper(btrim(capa_code))=v_code
    AND id<>COALESCE(NULLIF(p_row->>'product_id','')::bigint,0)) THEN
    RETURN jsonb_build_object('status','ok','capa_code',v_code,'created',false);
  END IF;
  INSERT INTO public.notifications(type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at)
  VALUES('new_cover',v_code,NULLIF(p_row->>'product_id','')::bigint,NULLIF(btrim(p_row->>'sku'),''),
    NULLIF(btrim(p_row->>'product_name'),''),NULLIF(btrim(p_row->>'variacao'),''),
    NULLIF(upper(btrim(p_row->>'platform')),''),COALESCE(NULLIF(btrim(p_row->>'image_key'),''),
      (SELECT image_key FROM public.cover_visual_references WHERE upper(btrim(capa_code))=v_code
       AND active=1 AND image_key IS NOT NULL ORDER BY id LIMIT 1)),now())
  ON CONFLICT(capa_code) DO NOTHING RETURNING id INTO v_id;
  v_created := v_id IS NOT NULL;
  RETURN jsonb_build_object('status','ok','capa_code',v_code,'created',v_created,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_update_notification_image_v1(p_product_id bigint,p_capa_code text,p_image_key text)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_changed integer;
BEGIN
  UPDATE public.notifications SET image_key=p_image_key
  WHERE (image_key IS NULL OR image_key='') AND (
    (p_product_id>0 AND product_id=p_product_id) OR
    (NULLIF(btrim(p_capa_code),'') IS NOT NULL AND upper(btrim(capa_code))=upper(btrim(p_capa_code)))
  );
  GET DIAGNOSTICS v_changed = ROW_COUNT; RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mark_notification_read_v1(
  p_notification_id bigint,p_user_id text,p_admin_only boolean DEFAULT false
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE id=p_notification_id AND
    (CASE WHEN p_admin_only THEN type<>'new_cover' AND capa_code LIKE '__SYS__%' ELSE type='new_cover' END)) THEN
    RETURN false;
  END IF;
  INSERT INTO public.notification_reads(notification_id,user_id,read_at)
  VALUES(p_notification_id,left(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100),now())
  ON CONFLICT(notification_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mark_all_notifications_read_v1(p_user_id text,p_admin_only boolean DEFAULT false)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_changed integer; v_user text := left(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100);
BEGIN
  WITH inserted AS (
    INSERT INTO public.notification_reads(notification_id,user_id,read_at)
    SELECT id,v_user,now() FROM public.notifications
    WHERE CASE WHEN p_admin_only THEN type<>'new_cover' AND capa_code LIKE '__SYS__%' ELSE type='new_cover' END
    ON CONFLICT(notification_id,user_id) DO NOTHING RETURNING 1
  ) SELECT count(*)::integer INTO v_changed FROM inserted;
  RETURN v_changed;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_record_admin_system_notification_v1(p_row jsonb)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_id bigint; v_marker text := '__SYS__' || floor(extract(epoch from clock_timestamp())*1000)::bigint || '_' || gen_random_uuid()::text;
BEGIN
  INSERT INTO public.notifications(type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at)
  VALUES(COALESCE(NULLIF(btrim(p_row->>'event_type'),''),'system_activity'),v_marker,NULL,
    NULLIF(btrim(p_row->>'entity_id'),''),COALESCE(NULLIF(btrim(p_row->>'title'),''),'Atividade no sistema'),
    COALESCE(NULLIF(btrim(p_row->>'message'),''),NULLIF(btrim(p_row->>'title'),''),'Atividade no sistema'),
    p_row->>'envelope',NULLIF(btrim(p_row->>'request_path'),''),now()) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_record_new_cover_notification_v1(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_update_notification_image_v1(bigint,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_mark_notification_read_v1(bigint,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_mark_all_notifications_read_v1(text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_record_admin_system_notification_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_record_new_cover_notification_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_update_notification_image_v1(bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mark_notification_read_v1(bigint,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mark_all_notifications_read_v1(text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_record_admin_system_notification_v1(jsonb) TO service_role;
