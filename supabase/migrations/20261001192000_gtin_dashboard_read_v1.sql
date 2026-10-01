CREATE OR REPLACE FUNCTION public.nisti_reserve_gtin_dashboard_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH active AS (
    SELECT
      COUNT(*)::bigint AS active_gtins,
      COUNT(DISTINCT product_id)::bigint AS products_with_gtin
    FROM public.product_gtins
    WHERE active IS TRUE
  ),
  today AS (
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE status = 'identified')::bigint AS identified,
      COUNT(*) FILTER (WHERE status = 'not_found' AND dismissed_at IS NULL)::bigint AS not_found,
      COUNT(*) FILTER (WHERE status = 'system_error')::bigint AS system_errors
    FROM public.gtin_scan_events
    WHERE timezone('America/Sao_Paulo', created_at)::date = timezone('America/Sao_Paulo', now())::date
  ),
  missing AS (
    SELECT p.*,
      (SELECT pp.platform FROM public.product_platforms pp WHERE pp.product_id = p.id ORDER BY pp.id ASC LIMIT 1) AS platform,
      (SELECT pp.link FROM public.product_platforms pp WHERE pp.product_id = p.id ORDER BY pp.id ASC LIMIT 1) AS link
    FROM public.products p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.product_gtins g WHERE g.product_id = p.id AND g.active IS TRUE
    )
  ),
  missing_payload AS (
    SELECT
      COUNT(*)::bigint AS total,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', id,
            'sku', sku,
            'miolo_code', miolo_code,
            'capa_code', capa_code,
            'acabamento_code', acabamento_code,
            'wireo_code', wireo_code,
            'tassel_code', tassel_code,
            'elastico_code', elastico_code,
            'nome', nome,
            'variacao', variacao,
            'image_key', image_key,
            'created_at', created_at,
            'platform', platform,
            'link', link
          ) ORDER BY id DESC
        ) FILTER (WHERE rn <= 1000),
        '[]'::jsonb
      ) AS products
    FROM (
      SELECT missing.*, row_number() OVER (ORDER BY id DESC) AS rn
      FROM missing
    ) ranked
  )
  SELECT jsonb_build_object(
    'active_gtins', active.active_gtins,
    'products_with_gtin', active.products_with_gtin,
    'products_without_gtin_count', missing_payload.total,
    'products_without_gtin', missing_payload.products,
    'today', jsonb_build_object(
      'total', today.total,
      'identified', today.identified,
      'not_found', today.not_found,
      'system_errors', today.system_errors
    )
  )
  FROM active CROSS JOIN today CROSS JOIN missing_payload;
$$;

REVOKE ALL ON FUNCTION public.nisti_reserve_gtin_dashboard_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_gtin_dashboard_v1() TO service_role;
