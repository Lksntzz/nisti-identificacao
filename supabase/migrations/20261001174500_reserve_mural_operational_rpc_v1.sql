-- Operational RPCs used after the initial reserve backfill.

CREATE OR REPLACE FUNCTION public.nisti_delete_mural_post_v1(p_id bigint)
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  DELETE FROM public.mural_posts WHERE id=p_id;
$function$;
REVOKE ALL ON FUNCTION public.nisti_delete_mural_post_v1(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_delete_mural_post_v1(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_replace_mural_collection_products_v1(
  p_collection_id bigint,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.mural_collection_products WHERE collection_id=p_collection_id;

  INSERT INTO public.mural_collection_products(collection_id,product_id,sort_order)
  SELECT p_collection_id,x.product_id,COALESCE(x.sort_order,0)
  FROM jsonb_to_recordset(COALESCE(p_rows,'[]'::jsonb)) AS x(
    product_id bigint,sort_order integer
  )
  WHERE x.product_id IS NOT NULL AND x.product_id>0
  ON CONFLICT (collection_id,product_id) DO UPDATE SET sort_order=EXCLUDED.sort_order;
END;
$function$;
REVOKE ALL ON FUNCTION public.nisti_replace_mural_collection_products_v1(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_replace_mural_collection_products_v1(bigint,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_unread_v1(p_user_id text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_total bigint;
BEGIN
  IF NOT public.nisti_reserve_mural_ready_v1() THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:mural';
  END IF;

  SELECT COUNT(*)::bigint INTO v_total
  FROM public.mural_posts mp
  LEFT JOIN public.mural_post_reads mr
    ON mr.post_id=mp.id
   AND mr.user_id=LEFT(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100)
  WHERE mp.status='published'
    AND mp.published_at IS NOT NULL
    AND mp.published_at<=now()
    AND (mp.expires_at IS NULL OR mp.expires_at>now())
    AND mr.post_id IS NULL;

  RETURN COALESCE(v_total,0);
END;
$function$;
REVOKE ALL ON FUNCTION public.nisti_reserve_mural_unread_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_mural_unread_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_post_image_v1(p_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF NOT public.nisti_reserve_mural_ready_v1() THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:mural';
  END IF;

  SELECT image_key INTO v_key
  FROM public.mural_posts
  WHERE id=p_id
    AND status='published'
    AND published_at IS NOT NULL
    AND published_at<=now()
    AND (expires_at IS NULL OR expires_at>now())
  LIMIT 1;

  RETURN v_key;
END;
$function$;
REVOKE ALL ON FUNCTION public.nisti_reserve_mural_post_image_v1(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_mural_post_image_v1(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_collection_image_v1(p_slug text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  IF NOT public.nisti_reserve_mural_ready_v1() THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:mural';
  END IF;

  SELECT image_key INTO v_key
  FROM public.mural_collections
  WHERE slug=p_slug AND status='active'
  LIMIT 1;

  RETURN v_key;
END;
$function$;
REVOKE ALL ON FUNCTION public.nisti_reserve_mural_collection_image_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_mural_collection_image_v1(text) TO service_role;
