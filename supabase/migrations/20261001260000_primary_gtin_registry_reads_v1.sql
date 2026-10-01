CREATE OR REPLACE FUNCTION public.nisti_gtin_registry_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'gtins',COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.active DESC,x.id DESC)
      FROM (
        SELECT
          g.id,g.product_id,g.gtin,g.gtin_type,g.source,g.active,g.created_at,g.updated_at,
          p.sku,p.miolo_code,p.nome,p.variacao,p.capa_code,p.image_key,
          COALESCE((
            SELECT jsonb_agg(DISTINCT pp.platform)
            FROM public.product_platforms pp
            WHERE pp.product_id=p.id
              AND BTRIM(COALESCE(pp.platform,''))<>''
          ),'[]'::jsonb) AS platforms
        FROM public.product_gtins g
        JOIN public.products p ON p.id=g.product_id
        ORDER BY g.active DESC,g.id DESC
        LIMIT 2000
      ) x
    ),'[]'::jsonb),
    'stats',jsonb_build_object(
      'active_gtins',(SELECT count(*) FROM public.product_gtins WHERE active=true),
      'products_total',(SELECT count(*) FROM public.products),
      'products_with_gtin',(
        SELECT count(DISTINCT product_id)
        FROM public.product_gtins
        WHERE active=true
      ),
      'products_without_gtin',GREATEST(
        (SELECT count(*) FROM public.products)
        - (
          SELECT count(DISTINCT product_id)
          FROM public.product_gtins
          WHERE active=true
        ),
        0
      )
    )
  )
$$;

REVOKE ALL ON FUNCTION public.nisti_gtin_registry_v1()
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_gtin_registry_v1()
  TO service_role;
