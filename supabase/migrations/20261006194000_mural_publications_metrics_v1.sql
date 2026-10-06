-- Consolidate Mural metrics into Publications and remove the retired QA readiness RPC.

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_posts_v1(
  p_status text DEFAULT NULL,
  p_kind text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY
    CASE x.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
    COALESCE(x.published_at,x.created_at) DESC,
    x.id DESC
  ),'[]'::jsonb)
  FROM (
    SELECT
      mp.*,
      p.sku AS product_sku,
      p.nome AS product_name,
      p.miolo_code AS product_miolo_code,
      p.image_key AS product_image_key,
      p.wireo_code,
      p.tassel_code,
      p.elastico_code,
      (
        SELECT mc2.name
        FROM public.mural_collection_products mcp2
        JOIN public.mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS product_collection_name,
      mc.name AS collection_name,
      mc.slug AS collection_slug,
      mc.image_key AS collection_image_key,
      (
        SELECT count(*)::bigint
        FROM public.mural_post_reads mr
        WHERE mr.post_id=mp.id
      ) AS reads
    FROM public.mural_posts mp
    LEFT JOIN public.products p ON p.id=mp.product_id
    LEFT JOIN public.mural_collections mc ON mc.id=mp.collection_id
    WHERE (NULLIF(BTRIM(p_status),'') IS NULL OR mp.status=BTRIM(p_status))
      AND (NULLIF(BTRIM(p_kind),'') IS NULL OR mp.kind=BTRIM(p_kind))
    LIMIT 200
  ) x
$$;

REVOKE ALL ON FUNCTION public.nisti_admin_mural_posts_v1(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_posts_v1(text,text) TO service_role;

DROP FUNCTION IF EXISTS public.nisti_admin_mural_readiness_v1();
