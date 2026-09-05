-- NISTI ID — Phase 6D
-- Secondary operational state remains D1-authoritative while mirror mode is staged.
-- All functions are server-only RPCs invoked by the Cloudflare Worker service role.

CREATE OR REPLACE FUNCTION public.nisti_mirror_visual_references_batch(
  p_references JSONB,
  p_embeddings JSONB DEFAULT '[]'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_reference JSONB;
  v_reference_id BIGINT;
  v_embedding JSONB;
BEGIN
  IF jsonb_typeof(COALESCE(p_references, '[]'::JSONB)) <> 'array'
     OR jsonb_typeof(COALESCE(p_embeddings, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'batch arguments must be arrays';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_embeddings, '[]'::JSONB)) AS e(value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_references, '[]'::JSONB)) AS r(value)
      WHERE NULLIF(r.value->>'id', '')::BIGINT = NULLIF(e.value->>'reference_id', '')::BIGINT
    )
  ) THEN
    RAISE EXCEPTION 'embedding references row outside batch';
  END IF;

  FOR v_reference IN
    SELECT r.value
    FROM jsonb_array_elements(COALESCE(p_references, '[]'::JSONB)) AS r(value)
  LOOP
    v_reference_id := NULLIF(v_reference->>'id', '')::BIGINT;
    IF v_reference_id IS NULL OR v_reference_id <= 0 THEN
      RAISE EXCEPTION 'invalid reference id in batch';
    END IF;

    SELECT e.value
    INTO v_embedding
    FROM jsonb_array_elements(COALESCE(p_embeddings, '[]'::JSONB)) AS e(value)
    WHERE NULLIF(e.value->>'reference_id', '')::BIGINT = v_reference_id
    LIMIT 1;

    PERFORM public.nisti_mirror_visual_reference(v_reference, v_embedding);
    v_embedding := NULL;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_notifications_batch(p_rows JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::JSONB)) AS x(
      id BIGINT,
      type TEXT,
      capa_code TEXT,
      product_id BIGINT,
      sku TEXT,
      product_name TEXT,
      variacao TEXT,
      platform TEXT,
      image_key TEXT,
      created_at TIMESTAMPTZ
    )
    WHERE x.id IS NULL OR x.id <= 0 OR NULLIF(BTRIM(x.capa_code), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid notification row';
  END IF;

  INSERT INTO public.notifications (
    id,type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
  )
  SELECT
    x.id,
    COALESCE(NULLIF(x.type, ''), 'new_cover'),
    x.capa_code,
    x.product_id,
    x.sku,
    x.product_name,
    x.variacao,
    x.platform,
    x.image_key,
    COALESCE(x.created_at, now())
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::JSONB)) AS x(
    id BIGINT,
    type TEXT,
    capa_code TEXT,
    product_id BIGINT,
    sku TEXT,
    product_name TEXT,
    variacao TEXT,
    platform TEXT,
    image_key TEXT,
    created_at TIMESTAMPTZ
  )
  ON CONFLICT (id) DO UPDATE SET
    type = EXCLUDED.type,
    capa_code = EXCLUDED.capa_code,
    product_id = EXCLUDED.product_id,
    sku = EXCLUDED.sku,
    product_name = EXCLUDED.product_name,
    variacao = EXCLUDED.variacao,
    platform = EXCLUDED.platform,
    image_key = EXCLUDED.image_key,
    created_at = EXCLUDED.created_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_notification_reads_batch(p_rows JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::JSONB)) AS x(
      id BIGINT,
      notification_id BIGINT,
      user_id TEXT,
      read_at TIMESTAMPTZ
    )
    WHERE x.id IS NULL OR x.id <= 0
       OR x.notification_id IS NULL OR x.notification_id <= 0
       OR NULLIF(BTRIM(x.user_id), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid notification read row';
  END IF;

  INSERT INTO public.notification_reads (id,notification_id,user_id,read_at)
  SELECT x.id,x.notification_id,x.user_id,COALESCE(x.read_at, now())
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::JSONB)) AS x(
    id BIGINT,
    notification_id BIGINT,
    user_id TEXT,
    read_at TIMESTAMPTZ
  )
  ON CONFLICT (id) DO UPDATE SET
    notification_id = EXCLUDED.notification_id,
    user_id = EXCLUDED.user_id,
    read_at = EXCLUDED.read_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_push_subscription(p_row JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
  v_endpoint TEXT;
BEGIN
  v_id := NULLIF(p_row->>'id', '')::BIGINT;
  v_endpoint := NULLIF(BTRIM(p_row->>'endpoint'), '');
  IF v_id IS NULL OR v_id <= 0 OR v_endpoint IS NULL THEN
    RAISE EXCEPTION 'invalid push subscription row';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.push_subscriptions
    WHERE endpoint = v_endpoint AND id <> v_id
  ) THEN
    RAISE EXCEPTION 'push endpoint id divergence';
  END IF;

  INSERT INTO public.push_subscriptions (
    id,user_id,endpoint,p256dh,auth,created_at,updated_at
  ) VALUES (
    v_id,
    p_row->>'user_id',
    v_endpoint,
    p_row->>'p256dh',
    p_row->>'auth',
    COALESCE(NULLIF(p_row->>'created_at', '')::TIMESTAMPTZ, now()),
    COALESCE(NULLIF(p_row->>'updated_at', '')::TIMESTAMPTZ, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    endpoint = EXCLUDED.endpoint,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_delete_push_subscription(p_endpoint TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NULLIF(BTRIM(p_endpoint), '') IS NULL THEN
    RAISE EXCEPTION 'invalid push endpoint';
  END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint = BTRIM(p_endpoint);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_operator_name(
  p_operator_id TEXT,
  p_operator_name TEXT
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_changed BIGINT := 0;
  v_operator_id TEXT := NULLIF(BTRIM(p_operator_id), '');
  v_operator_name TEXT := NULLIF(BTRIM(p_operator_name), '');
BEGIN
  IF v_operator_id IS NULL OR v_operator_name IS NULL THEN
    RAISE EXCEPTION 'operator id and name are required';
  END IF;

  UPDATE public.recognition_events
  SET operator_name = LEFT(v_operator_name, 120)
  WHERE operator_id = v_operator_id
    AND (operator_name IS NULL OR operator_name = '' OR operator_name <> LEFT(v_operator_name, 120));

  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_mirror_visual_references_batch(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_notifications_batch(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_notification_reads_batch(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_push_subscription(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_delete_push_subscription(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_operator_name(TEXT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_mirror_visual_references_batch(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_notifications_batch(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_notification_reads_batch(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_push_subscription(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_delete_push_subscription(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_operator_name(TEXT, TEXT) TO service_role;
