CREATE SEQUENCE IF NOT EXISTS public.gtin_scan_events_id_seq;
ALTER SEQUENCE public.gtin_scan_events_id_seq OWNED BY public.gtin_scan_events.id;
SELECT setval(
  'public.gtin_scan_events_id_seq',
  COALESCE((SELECT max(id) FROM public.gtin_scan_events), 0) + 1,
  false
);
ALTER TABLE public.gtin_scan_events
  ALTER COLUMN id SET DEFAULT nextval('public.gtin_scan_events_id_seq');
REVOKE ALL ON SEQUENCE public.gtin_scan_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.gtin_scan_events_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_record_gtin_scan_event_v1(
  p_gtin text, p_status text, p_product_id bigint DEFAULT NULL,
  p_operator_name text DEFAULT NULL, p_operator_id text DEFAULT NULL,
  p_response_ms integer DEFAULT 0, p_error_code text DEFAULT NULL,
  p_created_at timestamptz DEFAULT now()
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_id bigint;
BEGIN
  IF p_gtin !~ '^[0-9]{13}$' THEN
    RAISE EXCEPTION 'GTIN-13 inválido.' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('identified', 'not_found', 'system_error') THEN
    RAISE EXCEPTION 'Status de leitura EAN inválido.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.gtin_scan_events (
    gtin,status,product_id,operator_name,operator_id,response_ms,error_code,
    created_at,dismissed_at,dismissed_by
  ) VALUES (
    p_gtin,p_status,p_product_id,NULLIF(btrim(p_operator_name),''),
    NULLIF(btrim(p_operator_id),''),greatest(0,least(120000,COALESCE(p_response_ms,0))),
    NULLIF(btrim(p_error_code),''),COALESCE(p_created_at,now()),NULL,NULL
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.nisti_record_gtin_scan_event_v1(text,text,bigint,text,text,integer,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_record_gtin_scan_event_v1(text,text,bigint,text,text,integer,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mark_mural_post_read_v1(p_post_id bigint,p_user_id text)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id text := left(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100);
  v_unread bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mural_posts
    WHERE id=p_post_id AND status='published' AND published_at IS NOT NULL
      AND published_at<=now() AND (expires_at IS NULL OR expires_at>now())
  ) THEN RETURN -1; END IF;
  INSERT INTO public.mural_post_reads(post_id,user_id,read_at)
  VALUES(p_post_id,v_user_id,now())
  ON CONFLICT(post_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at;
  SELECT count(*)::bigint INTO v_unread
  FROM public.mural_posts mp
  WHERE mp.status='published' AND mp.published_at IS NOT NULL
    AND mp.published_at<=now() AND (mp.expires_at IS NULL OR mp.expires_at>now())
    AND NOT EXISTS (
      SELECT 1 FROM public.mural_post_reads mr
      WHERE mr.post_id=mp.id AND mr.user_id=v_user_id
    );
  RETURN v_unread;
END;
$$;
REVOKE ALL ON FUNCTION public.nisti_mark_mural_post_read_v1(bigint,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mark_mural_post_read_v1(bigint,text) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mark_all_mural_posts_read_v1(p_user_id text)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE v_user_id text := left(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100);
BEGIN
  INSERT INTO public.mural_post_reads(post_id,user_id,read_at)
  SELECT id,v_user_id,now() FROM public.mural_posts
  WHERE status='published' AND published_at IS NOT NULL
    AND published_at<=now() AND (expires_at IS NULL OR expires_at>now())
  ON CONFLICT(post_id,user_id) DO UPDATE SET read_at=EXCLUDED.read_at;
  RETURN 0;
END;
$$;
REVOKE ALL ON FUNCTION public.nisti_mark_all_mural_posts_read_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mark_all_mural_posts_read_v1(text) TO service_role;
