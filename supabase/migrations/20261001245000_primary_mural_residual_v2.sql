-- Finish the Mural admin cutover so primary mode no longer mutates or reads D1 for active admin flows.

CREATE OR REPLACE FUNCTION public.nisti_clear_product_treatment_v1(p_product_id bigint)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_old text;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;

  SELECT processed_image_key INTO v_old
  FROM public.mural_product_images
  WHERE product_id=p_product_id;

  IF v_product.image_key IS NULL THEN
    DELETE FROM public.mural_product_images WHERE product_id=p_product_id;
    RETURN jsonb_build_object('status','ok','old_processed_image_key',v_old,'row',NULL);
  END IF;

  INSERT INTO public.mural_product_images(
    product_id,source_image_key,processed_image_key,status,processor,processor_version,
    reviewed_by,reviewed_at,error_message,updated_at
  ) VALUES(
    p_product_id,v_product.image_key,NULL,'pending',NULL,NULL,NULL,NULL,NULL,now()
  )
  ON CONFLICT(product_id) DO UPDATE SET
    source_image_key=EXCLUDED.source_image_key,
    processed_image_key=NULL,
    status='pending',
    processor=NULL,
    processor_version=NULL,
    reviewed_by=NULL,
    reviewed_at=NULL,
    error_message=NULL,
    updated_at=now();

  RETURN jsonb_build_object(
    'status','ok',
    'old_processed_image_key',v_old,
    'source_image_key',v_product.image_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_products_v1(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 80
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC,x.id DESC),'[]'::jsonb)
  FROM (
    SELECT
      p.id,p.sku,p.nome,p.variacao,p.image_key,p.wireo_code,p.tassel_code,p.elastico_code,p.miolo_code,p.updated_at,
      mpi.status AS mural_image_status,
      mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key,
      mpi.processor AS mural_image_processor,
      mpi.reviewed_at AS mural_image_reviewed_at,
      mpi.error_message AS mural_image_error,
      (
        SELECT mc2.name
        FROM public.mural_collection_products mcp2
        JOIN public.mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS collection_name
    FROM public.products p
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE NULLIF(BTRIM(COALESCE(p_query,'')),'') IS NULL
       OR p.sku ILIKE '%'||BTRIM(p_query)||'%'
       OR p.nome ILIKE '%'||BTRIM(p_query)||'%'
       OR COALESCE(p.variacao,'') ILIKE '%'||BTRIM(p_query)||'%'
    ORDER BY p.updated_at DESC,p.id DESC
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,80),500))
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_metrics_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'published_by_month',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('month',month,'total',total) ORDER BY month DESC)
      FROM (
        SELECT to_char(published_at AT TIME ZONE 'America/Sao_Paulo','YYYY-MM') AS month,count(*)::bigint AS total
        FROM public.mural_posts
        WHERE status='published' AND published_at IS NOT NULL
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 12
      ) m
    ),'[]'::jsonb),
    'readers',(SELECT count(DISTINCT user_id) FROM public.mural_post_reads),
    'top_reads',COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id',id,'title',title,'reads',reads) ORDER BY reads DESC,id DESC)
      FROM (
        SELECT mp.id,mp.title,count(mr.user_id)::bigint AS reads
        FROM public.mural_posts mp
        JOIN public.mural_post_reads mr ON mr.post_id=mp.id
        GROUP BY mp.id,mp.title
        ORDER BY reads DESC,mp.id DESC
        LIMIT 10
      ) r
    ),'[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_readiness_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  WITH live AS (
    SELECT
      mp.id,mp.kind,mp.title,mp.featured,mp.priority,mp.published_at,
      mp.image_key,
      p.image_key AS product_image_key,
      mc.image_key AS collection_image_key
    FROM public.mural_posts mp
    LEFT JOIN public.products p ON p.id=mp.product_id
    LEFT JOIN public.mural_collections mc ON mc.id=mp.collection_id
    WHERE mp.status='published'
      AND mp.published_at IS NOT NULL
      AND mp.published_at<=now()
      AND (mp.expires_at IS NULL OR mp.expires_at>now())
  )
  SELECT jsonb_build_object(
    'content',jsonb_build_object(
      'total',(SELECT count(*) FROM live),
      'products',(SELECT count(*) FROM live WHERE kind='product'),
      'collections',(SELECT count(*) FROM live WHERE kind='collection'),
      'notices',(SELECT count(*) FROM live WHERE kind='notice')
    ),
    'fold',COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.featured DESC,x.priority DESC,x.published_at DESC,x.id DESC)
      FROM (
        SELECT *
        FROM live
        ORDER BY featured DESC,priority DESC,published_at DESC,id DESC
        LIMIT 3
      ) x
    ),'[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_product_reference_v1(p_product_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT to_jsonb(x)
  FROM (
    SELECT
      p.id,p.sku,p.nome,p.variacao,p.image_key,p.wireo_code,p.tassel_code,p.elastico_code,p.miolo_code,
      mpi.status AS mural_image_status,
      mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key
    FROM public.products p
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.id=p_product_id
    LIMIT 1
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_collection_reference_v1(p_collection_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'collection',(
      SELECT to_jsonb(c)
      FROM (
        SELECT id,name,year,description,slug,status,image_key
        FROM public.mural_collections
        WHERE id=p_collection_id
        LIMIT 1
      ) c
    ),
    'products',COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.id)
      FROM (
        SELECT
          p.id,p.sku,p.nome,p.variacao,p.image_key,p.wireo_code,p.tassel_code,p.elastico_code,p.miolo_code,
          mcp.sort_order,
          mpi.status AS mural_image_status,
          mpi.reviewed_by AS mural_image_reviewed_by,
          mpi.source_image_key AS mural_source_image_key,
          mpi.processed_image_key AS mural_processed_image_key
        FROM public.mural_collection_products mcp
        JOIN public.products p ON p.id=mcp.product_id
        LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
        WHERE mcp.collection_id=p_collection_id AND p.image_key IS NOT NULL
        ORDER BY mcp.sort_order,p.id
        LIMIT 5
      ) x
    ),'[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.nisti_clear_product_treatment_v1(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_products_v1(text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_metrics_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_readiness_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_product_reference_v1(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_collection_reference_v1(bigint) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_clear_product_treatment_v1(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_products_v1(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_metrics_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_readiness_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_product_reference_v1(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_collection_reference_v1(bigint) TO service_role;
