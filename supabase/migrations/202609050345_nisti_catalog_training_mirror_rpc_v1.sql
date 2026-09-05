-- NISTI ID — Phase 6C
-- D1 remains authoritative. These RPCs only mirror committed D1 state into Supabase.
-- Browser roles must not execute them; Cloudflare Worker service_role only.

CREATE OR REPLACE FUNCTION public.nisti_mirror_product_catalog(
  p_product JSONB,
  p_platforms JSONB DEFAULT '[]'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  v_id := NULLIF(p_product->>'id', '')::BIGINT;
  IF v_id IS NULL OR v_id <= 0 THEN
    RAISE EXCEPTION 'invalid product id';
  END IF;

  IF jsonb_typeof(COALESCE(p_platforms, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'p_platforms must be an array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(COALESCE(p_platforms, '[]'::JSONB)) AS x(
      id BIGINT,
      product_id BIGINT,
      platform TEXT,
      link TEXT
    )
    WHERE x.id IS NULL OR x.id <= 0 OR x.product_id <> v_id OR NULLIF(BTRIM(x.platform), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid product platform row';
  END IF;

  INSERT INTO public.products (
    id,sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,
    nome,variacao,image_key,created_at,updated_at
  ) VALUES (
    v_id,
    p_product->>'sku',
    p_product->>'miolo_code',
    p_product->>'capa_code',
    p_product->>'acabamento_code',
    p_product->>'wireo_code',
    p_product->>'tassel_code',
    p_product->>'elastico_code',
    p_product->>'nome',
    p_product->>'variacao',
    p_product->>'image_key',
    COALESCE(NULLIF(p_product->>'created_at', '')::TIMESTAMPTZ, now()),
    COALESCE(NULLIF(p_product->>'updated_at', '')::TIMESTAMPTZ, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    sku = EXCLUDED.sku,
    miolo_code = EXCLUDED.miolo_code,
    capa_code = EXCLUDED.capa_code,
    acabamento_code = EXCLUDED.acabamento_code,
    wireo_code = EXCLUDED.wireo_code,
    tassel_code = EXCLUDED.tassel_code,
    elastico_code = EXCLUDED.elastico_code,
    nome = EXCLUDED.nome,
    variacao = EXCLUDED.variacao,
    image_key = EXCLUDED.image_key,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

  DELETE FROM public.product_platforms WHERE product_id = v_id;

  INSERT INTO public.product_platforms (id,product_id,platform,link)
  SELECT id,product_id,platform,link
  FROM jsonb_to_recordset(COALESCE(p_platforms, '[]'::JSONB)) AS x(
    id BIGINT,
    product_id BIGINT,
    platform TEXT,
    link TEXT
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_product_catalog_batch(
  p_products JSONB,
  p_platforms JSONB DEFAULT '[]'::JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_product JSONB;
  v_product_id BIGINT;
  v_product_platforms JSONB;
BEGIN
  IF jsonb_typeof(COALESCE(p_products, '[]'::JSONB)) <> 'array'
     OR jsonb_typeof(COALESCE(p_platforms, '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION 'batch arguments must be arrays';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(p_platforms, '[]'::JSONB)) AS p(value)
    WHERE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_products, '[]'::JSONB)) AS q(value)
      WHERE NULLIF(q.value->>'id', '')::BIGINT = NULLIF(p.value->>'product_id', '')::BIGINT
    )
  ) THEN
    RAISE EXCEPTION 'platform row references product outside batch';
  END IF;

  FOR v_product IN
    SELECT p.value
    FROM jsonb_array_elements(COALESCE(p_products, '[]'::JSONB)) AS p(value)
  LOOP
    v_product_id := NULLIF(v_product->>'id', '')::BIGINT;
    IF v_product_id IS NULL OR v_product_id <= 0 THEN
      RAISE EXCEPTION 'invalid product id in batch';
    END IF;

    SELECT COALESCE(jsonb_agg(p.value), '[]'::JSONB)
    INTO v_product_platforms
    FROM jsonb_array_elements(COALESCE(p_platforms, '[]'::JSONB)) AS p(value)
    WHERE NULLIF(p.value->>'product_id', '')::BIGINT = v_product_id;

    PERFORM public.nisti_mirror_product_catalog(v_product, v_product_platforms);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_delete_product_catalog(p_product_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_product_id IS NULL OR p_product_id <= 0 THEN
    RAISE EXCEPTION 'invalid product id';
  END IF;

  -- Match D1 deletion semantics before deleting the product itself.
  DELETE FROM public.cover_visual_references WHERE source_product_id = p_product_id;
  DELETE FROM public.notifications WHERE product_id = p_product_id;
  DELETE FROM public.products WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_mirror_visual_reference(
  p_reference JSONB,
  p_embedding JSONB DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  v_id := NULLIF(p_reference->>'id', '')::BIGINT;
  IF v_id IS NULL OR v_id <= 0 THEN
    RAISE EXCEPTION 'invalid reference id';
  END IF;

  INSERT INTO public.cover_visual_references (
    id,capa_code,image_key,source_product_id,reference_kind,active,created_at,updated_at
  ) VALUES (
    v_id,
    p_reference->>'capa_code',
    p_reference->>'image_key',
    NULLIF(p_reference->>'source_product_id', '')::BIGINT,
    COALESCE(NULLIF(p_reference->>'reference_kind', ''), 'product'),
    COALESCE(NULLIF(p_reference->>'active', '')::INTEGER, 1),
    COALESCE(NULLIF(p_reference->>'created_at', '')::TIMESTAMPTZ, now()),
    COALESCE(NULLIF(p_reference->>'updated_at', '')::TIMESTAMPTZ, now())
  )
  ON CONFLICT (id) DO UPDATE SET
    capa_code = EXCLUDED.capa_code,
    image_key = EXCLUDED.image_key,
    source_product_id = EXCLUDED.source_product_id,
    reference_kind = EXCLUDED.reference_kind,
    active = EXCLUDED.active,
    created_at = EXCLUDED.created_at,
    updated_at = EXCLUDED.updated_at;

  IF p_embedding IS NULL OR p_embedding = 'null'::JSONB THEN
    DELETE FROM public.cover_reference_embeddings WHERE reference_id = v_id;
  ELSE
    IF NULLIF(p_embedding->>'reference_id', '')::BIGINT IS DISTINCT FROM v_id THEN
      RAISE EXCEPTION 'embedding reference mismatch';
    END IF;

    INSERT INTO public.cover_reference_embeddings (
      reference_id,embedding_model,dimensions,embedding_json,updated_at
    ) VALUES (
      v_id,
      p_embedding->>'embedding_model',
      NULLIF(p_embedding->>'dimensions', '')::INTEGER,
      p_embedding->>'embedding_json',
      COALESCE(NULLIF(p_embedding->>'updated_at', '')::TIMESTAMPTZ, now())
    )
    ON CONFLICT (reference_id) DO UPDATE SET
      embedding_model = EXCLUDED.embedding_model,
      dimensions = EXCLUDED.dimensions,
      embedding_json = EXCLUDED.embedding_json,
      updated_at = EXCLUDED.updated_at;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_delete_visual_reference(p_reference_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF p_reference_id IS NULL OR p_reference_id <= 0 THEN
    RAISE EXCEPTION 'invalid reference id';
  END IF;
  DELETE FROM public.cover_visual_references WHERE id = p_reference_id;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_mirror_product_catalog(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_product_catalog_batch(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_delete_product_catalog(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_mirror_visual_reference(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_delete_visual_reference(BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_mirror_product_catalog(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_product_catalog_batch(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_delete_product_catalog(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_visual_reference(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_delete_visual_reference(BIGINT) TO service_role;
