-- NISTI ID — Supabase operator read API v1
-- Server-only RPCs used by the Cloudflare Worker during the D1 -> Supabase cutover.
-- Browser roles receive no EXECUTE grant.

CREATE OR REPLACE FUNCTION public.nisti_list_platforms()
RETURNS TABLE(platform TEXT, product_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    upper(btrim(pp.platform)) AS platform,
    count(DISTINCT pp.product_id)::bigint AS product_count
  FROM public.product_platforms pp
  WHERE btrim(coalesce(pp.platform, '')) <> ''
  GROUP BY upper(btrim(pp.platform))
  ORDER BY upper(btrim(pp.platform));
$$;

CREATE OR REPLACE FUNCTION public.nisti_platform_exists(p_platform TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.product_platforms pp
    WHERE upper(btrim(pp.platform)) = upper(btrim(coalesce(p_platform, '')))
    LIMIT 1
  );
$$;

CREATE OR REPLACE FUNCTION public.nisti_platforms_for_reference(
  p_source_product_id BIGINT,
  p_capa_code TEXT
)
RETURNS TABLE(platform TEXT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT upper(btrim(pp.platform)) AS platform
  FROM public.product_platforms pp
  JOIN public.products p ON p.id = pp.product_id
  WHERE btrim(coalesce(pp.platform, '')) <> ''
    AND (
      (coalesce(p_source_product_id, 0) > 0 AND pp.product_id = p_source_product_id)
      OR
      (
        coalesce(p_source_product_id, 0) <= 0
        AND upper(btrim(p.capa_code)) = upper(btrim(coalesce(p_capa_code, '')))
      )
    )
  ORDER BY platform;
$$;

CREATE OR REPLACE FUNCTION public.nisti_active_references(p_ids BIGINT[])
RETURNS TABLE(
  id BIGINT,
  capa_code TEXT,
  image_key TEXT,
  source_product_id BIGINT,
  reference_kind TEXT,
  active INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.capa_code,
    r.image_key,
    r.source_product_id,
    r.reference_kind,
    r.active
  FROM public.cover_visual_references r
  WHERE r.active = 1
    AND r.id = ANY(coalesce(p_ids, ARRAY[]::bigint[]))
  ORDER BY r.id;
$$;

CREATE OR REPLACE FUNCTION public.nisti_reference_by_id(p_reference_id BIGINT)
RETURNS TABLE(
  id BIGINT,
  capa_code TEXT,
  image_key TEXT,
  source_product_id BIGINT,
  reference_kind TEXT,
  active INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.capa_code,
    r.image_key,
    r.source_product_id,
    r.reference_kind,
    r.active
  FROM public.cover_visual_references r
  WHERE r.id = p_reference_id
    AND r.active = 1
    AND r.image_key IS NOT NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.nisti_reference_by_cover(p_capa_code TEXT)
RETURNS TABLE(
  id BIGINT,
  capa_code TEXT,
  image_key TEXT,
  source_product_id BIGINT,
  reference_kind TEXT,
  active INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    r.id,
    r.capa_code,
    r.image_key,
    r.source_product_id,
    r.reference_kind,
    r.active
  FROM public.cover_visual_references r
  WHERE upper(btrim(r.capa_code)) = upper(btrim(coalesce(p_capa_code, '')))
    AND r.active = 1
    AND r.image_key IS NOT NULL
  ORDER BY r.id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.nisti_products_for_cover(
  p_capa_code TEXT,
  p_platform TEXT
)
RETURNS TABLE(
  id BIGINT,
  sku TEXT,
  miolo_code TEXT,
  capa_code TEXT,
  acabamento_code TEXT,
  wireo_code TEXT,
  tassel_code TEXT,
  elastico_code TEXT,
  nome TEXT,
  variacao TEXT,
  image_key TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  platform TEXT,
  link TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.sku,
    p.miolo_code,
    p.capa_code,
    p.acabamento_code,
    p.wireo_code,
    p.tassel_code,
    p.elastico_code,
    p.nome,
    p.variacao,
    p.image_key,
    p.created_at,
    p.updated_at,
    pp.platform,
    pp.link
  FROM public.products p
  JOIN public.product_platforms pp ON pp.product_id = p.id
  WHERE upper(btrim(p.capa_code)) = upper(btrim(coalesce(p_capa_code, '')))
    AND upper(btrim(pp.platform)) = upper(btrim(coalesce(p_platform, '')))
  ORDER BY p.id, pp.id;
$$;

CREATE OR REPLACE FUNCTION public.nisti_image_key(p_entity TEXT, p_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result_key TEXT;
BEGIN
  CASE lower(btrim(coalesce(p_entity, '')))
    WHEN 'product' THEN
      SELECT p.image_key INTO result_key
      FROM public.products p
      WHERE p.id = p_id
      LIMIT 1;
    WHEN 'reference' THEN
      SELECT r.image_key INTO result_key
      FROM public.cover_visual_references r
      WHERE r.id = p_id AND r.active = 1
      LIMIT 1;
    WHEN 'occurrence' THEN
      SELECT o.image_key INTO result_key
      FROM public.scan_occurrences o
      WHERE o.id = p_id
      LIMIT 1;
    ELSE
      result_key := NULL;
  END CASE;
  RETURN result_key;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_list_platforms() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_platform_exists(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_platforms_for_reference(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_active_references(BIGINT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_reference_by_id(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_reference_by_cover(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_products_for_cover(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_image_key(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_list_platforms() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_platform_exists(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_platforms_for_reference(BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_active_references(BIGINT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_reference_by_id(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_reference_by_cover(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_products_for_cover(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_image_key(TEXT, BIGINT) TO service_role;
