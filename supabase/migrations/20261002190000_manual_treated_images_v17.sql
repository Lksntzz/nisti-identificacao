-- Manual-only treated image contract v17.
-- Existing derivatives remain stored for audit/rollback, but are no longer
-- eligible for display or approval until explicitly regenerated with v17.

UPDATE public.mural_product_images
SET
  status='pending',
  reviewed_by=NULL,
  reviewed_at=NULL,
  error_message=NULL,
  updated_at=now()
WHERE processed_image_key IS NOT NULL
  AND COALESCE(processor_version,'') <> '17';

CREATE OR REPLACE FUNCTION public.nisti_image_key(p_entity text, p_id bigint)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  result_key text;
BEGIN
  CASE lower(btrim(coalesce(p_entity,'')))
    WHEN 'product' THEN
      SELECT p.image_key INTO result_key
      FROM public.products p
      WHERE p.id=p_id
      LIMIT 1;
    WHEN 'product-display' THEN
      SELECT CASE
        WHEN mpi.status='approved'
          AND mpi.processed_image_key IS NOT NULL
          AND mpi.source_image_key=p.image_key
          AND mpi.reviewed_by='admin'
          AND mpi.processor_version='17'
        THEN mpi.processed_image_key
        ELSE p.image_key
      END
      INTO result_key
      FROM public.products p
      LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
      WHERE p.id=p_id
      LIMIT 1;
    WHEN 'mural-product' THEN
      SELECT mpi.processed_image_key INTO result_key
      FROM public.mural_product_images mpi
      INNER JOIN public.products p ON p.id=mpi.product_id
      WHERE mpi.product_id=p_id
        AND mpi.status='approved'
        AND mpi.processed_image_key IS NOT NULL
        AND mpi.source_image_key=p.image_key
        AND mpi.reviewed_by='admin'
        AND mpi.processor_version='17'
      LIMIT 1;
    ELSE
      result_key := NULL;
  END CASE;
  RETURN result_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_products_v1(
  p_query text DEFAULT NULL::text,
  p_limit integer DEFAULT 80
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.updated_at DESC,x.id DESC),'[]'::jsonb)
  FROM (
    SELECT
      p.id,p.sku,p.nome,p.variacao,p.image_key,p.wireo_code,p.tassel_code,p.elastico_code,p.miolo_code,p.updated_at,
      mpi.status AS mural_image_status,
      mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key,
      mpi.processor AS mural_image_processor,
      mpi.processor_version AS mural_image_processor_version,
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
$function$;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_collection_v1(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_collection jsonb;
  v_products jsonb;
  v_id bigint;
BEGIN
  IF NOT public.nisti_reserve_mural_ready_v1() THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:mural';
  END IF;

  SELECT c.id,to_jsonb(c)
  INTO v_id,v_collection
  FROM (
    SELECT id,slug,name,year,description,image_key,status
    FROM public.mural_collections
    WHERE slug=p_slug AND status='active'
    LIMIT 1
  ) c;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.sku,x.id),'[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      p.id,p.sku,p.miolo_code,p.nome,p.variacao,p.wireo_code,p.tassel_code,p.elastico_code,p.image_key,
      mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key,
      mpi.processor_version AS mural_image_processor_version,
      mcp.sort_order
    FROM public.mural_collection_products mcp
    INNER JOIN public.products p ON p.id=mcp.product_id
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE mcp.collection_id=v_id
  ) x;

  RETURN jsonb_build_object('collection',v_collection,'products',v_products);
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_feed_v1(
  p_user_id text,
  p_kind text DEFAULT NULL::text,
  p_limit integer DEFAULT 20,
  p_cursor_featured boolean DEFAULT NULL::boolean,
  p_cursor_priority integer DEFAULT NULL::integer,
  p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id bigint DEFAULT NULL::bigint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1,LEAST(50,COALESCE(p_limit,20)));
  v_rows jsonb;
  v_preview jsonb;
  v_unread bigint;
BEGIN
  IF NOT public.nisti_reserve_mural_ready_v1() THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:mural';
  END IF;

  WITH feed AS (
    SELECT
      mp.id,mp.kind,mp.title,mp.subtitle,mp.body,mp.badge,mp.badge_tone,
      mp.featured,mp.priority,mp.published_at,mp.expires_at,mp.image_key,
      mp.notice_level,
      p.id AS product_id,p.sku,p.miolo_code,p.nome AS product_name,
      p.wireo_code,p.tassel_code,p.elastico_code,p.image_key AS product_image_key,
      mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key,
      mpi.processor_version AS mural_image_processor_version,
      (
        SELECT mc2.name
        FROM public.mural_collection_products mcp2
        INNER JOIN public.mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS product_collection_name,
      mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,
      mc.year AS collection_year,mc.description AS collection_description,
      mc.image_key AS collection_image_key,
      (mr.post_id IS NOT NULL) AS is_read
    FROM public.mural_posts mp
    LEFT JOIN public.products p ON p.id=mp.product_id
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    LEFT JOIN public.mural_collections mc ON mc.id=mp.collection_id
    LEFT JOIN public.mural_post_reads mr
      ON mr.post_id=mp.id
     AND mr.user_id=LEFT(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100)
    WHERE mp.status='published'
      AND mp.published_at IS NOT NULL
      AND mp.published_at <= now()
      AND (mp.expires_at IS NULL OR mp.expires_at > now())
      AND (NULLIF(btrim(COALESCE(p_kind,'')),'') IS NULL OR mp.kind=btrim(p_kind))
      AND (
        p_cursor_id IS NULL
        OR mp.featured < COALESCE(p_cursor_featured,false)
        OR (mp.featured = COALESCE(p_cursor_featured,false) AND mp.priority < COALESCE(p_cursor_priority,0))
        OR (
          mp.featured = COALESCE(p_cursor_featured,false)
          AND mp.priority = COALESCE(p_cursor_priority,0)
          AND mp.published_at < p_cursor_published_at
        )
        OR (
          mp.featured = COALESCE(p_cursor_featured,false)
          AND mp.priority = COALESCE(p_cursor_priority,0)
          AND mp.published_at = p_cursor_published_at
          AND mp.id < p_cursor_id
        )
      )
    ORDER BY mp.featured DESC,mp.priority DESC,mp.published_at DESC,mp.id DESC
    LIMIT v_limit + 1
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(feed)),'[]'::jsonb)
  INTO v_rows
  FROM feed;

  WITH ids AS (
    SELECT DISTINCT (x->>'collection_id')::bigint AS collection_id
    FROM jsonb_array_elements(v_rows) x
    WHERE x->>'kind'='collection' AND NULLIF(x->>'collection_id','') IS NOT NULL
  ),
  previews AS (
    SELECT
      mcp.collection_id,mcp.sort_order,
      p.id,p.sku,p.nome,p.variacao,p.miolo_code,p.image_key,
      mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key,
      mpi.processor_version AS mural_image_processor_version
    FROM public.mural_collection_products mcp
    INNER JOIN ids ON ids.collection_id=mcp.collection_id
    INNER JOIN public.products p ON p.id=mcp.product_id
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    ORDER BY mcp.collection_id ASC,mcp.sort_order ASC,p.sku ASC,p.id ASC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(previews)),'[]'::jsonb)
  INTO v_preview
  FROM previews;

  SELECT COUNT(*)::bigint
  INTO v_unread
  FROM public.mural_posts mp
  LEFT JOIN public.mural_post_reads mr
    ON mr.post_id=mp.id
   AND mr.user_id=LEFT(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100)
  WHERE mp.status='published'
    AND mp.published_at IS NOT NULL
    AND mp.published_at <= now()
    AND (mp.expires_at IS NULL OR mp.expires_at > now())
    AND mr.post_id IS NULL;

  RETURN jsonb_build_object(
    'rows',v_rows,
    'preview_rows',v_preview,
    'unread_count',COALESCE(v_unread,0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_set_product_treatment_v2(
  p_product_id bigint,
  p_action text,
  p_processed_image_key text DEFAULT NULL::text,
  p_mask_image_key text DEFAULT NULL::text,
  p_processor text DEFAULT NULL::text,
  p_processor_version text DEFAULT NULL::text,
  p_error_message text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_row public.mural_product_images%ROWTYPE;
  v_old_processed text;
  v_old_mask text;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF v_product.id IS NULL OR v_product.image_key IS NULL THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  SELECT processed_image_key,mask_image_key
  INTO v_old_processed,v_old_mask
  FROM public.mural_product_images
  WHERE product_id=p_product_id;

  IF p_action='review' THEN
    IF p_processed_image_key IS NULL OR p_mask_image_key IS NULL OR NULLIF(btrim(p_processor_version),'') IS NULL THEN
      RETURN jsonb_build_object('status','invalid_artifacts');
    END IF;

    INSERT INTO public.mural_product_images(
      product_id,source_image_key,processed_image_key,mask_image_key,mask_processor_version,mask_created_at,
      status,processor,processor_version,reviewed_by,reviewed_at,error_message,updated_at
    )
    VALUES(
      p_product_id,v_product.image_key,p_processed_image_key,p_mask_image_key,p_processor_version,now(),
      'review',p_processor,p_processor_version,NULL,NULL,NULL,now()
    )
    ON CONFLICT(product_id) DO UPDATE SET
      source_image_key=EXCLUDED.source_image_key,
      processed_image_key=EXCLUDED.processed_image_key,
      mask_image_key=EXCLUDED.mask_image_key,
      mask_processor_version=EXCLUDED.mask_processor_version,
      mask_created_at=EXCLUDED.mask_created_at,
      status='review',
      processor=EXCLUDED.processor,
      processor_version=EXCLUDED.processor_version,
      reviewed_by=NULL,
      reviewed_at=NULL,
      error_message=NULL,
      updated_at=now();

  ELSIF p_action='approve' THEN
    IF NOT EXISTS(
      SELECT 1 FROM public.mural_product_images
      WHERE product_id=p_product_id
        AND status='review'
        AND processed_image_key IS NOT NULL
        AND mask_image_key IS NOT NULL
        AND source_image_key=v_product.image_key
        AND processor_version=p_processor_version
        AND mask_processor_version=p_processor_version
    ) THEN
      RETURN jsonb_build_object('status','invalid_derivative');
    END IF;
    UPDATE public.mural_product_images
    SET status='approved',reviewed_by='admin',reviewed_at=now(),error_message=NULL,updated_at=now()
    WHERE product_id=p_product_id;

  ELSIF p_action='redo' THEN
    INSERT INTO public.mural_product_images(
      product_id,source_image_key,processed_image_key,mask_image_key,mask_processor_version,mask_created_at,
      status,processor,processor_version,reviewed_by,reviewed_at,error_message,updated_at
    )
    VALUES(
      p_product_id,v_product.image_key,NULL,NULL,NULL,NULL,
      'pending','system-precise-redo',NULL,NULL,NULL,NULL,now()
    )
    ON CONFLICT(product_id) DO UPDATE SET
      source_image_key=EXCLUDED.source_image_key,
      processed_image_key=NULL,
      mask_image_key=NULL,
      mask_processor_version=NULL,
      mask_created_at=NULL,
      status='pending',
      processor='system-precise-redo',
      processor_version=NULL,
      reviewed_by=NULL,
      reviewed_at=NULL,
      error_message=NULL,
      updated_at=now();

  ELSIF p_action='failed' THEN
    INSERT INTO public.mural_product_images(
      product_id,source_image_key,processed_image_key,mask_image_key,mask_processor_version,mask_created_at,
      status,processor,processor_version,reviewed_by,reviewed_at,error_message,updated_at
    )
    VALUES(
      p_product_id,v_product.image_key,NULL,NULL,NULL,NULL,
      'failed',p_processor,p_processor_version,NULL,NULL,left(p_error_message,500),now()
    )
    ON CONFLICT(product_id) DO UPDATE SET
      source_image_key=EXCLUDED.source_image_key,
      processed_image_key=NULL,
      mask_image_key=NULL,
      mask_processor_version=NULL,
      mask_created_at=NULL,
      status='failed',
      processor=EXCLUDED.processor,
      processor_version=EXCLUDED.processor_version,
      reviewed_by=NULL,
      reviewed_at=NULL,
      error_message=EXCLUDED.error_message,
      updated_at=now();
  ELSE
    RETURN jsonb_build_object('status','invalid_action');
  END IF;

  SELECT * INTO v_row FROM public.mural_product_images WHERE product_id=p_product_id;
  RETURN jsonb_build_object(
    'status','ok',
    'old_processed_image_key',v_old_processed,
    'old_mask_image_key',v_old_mask,
    'row',to_jsonb(v_row)
  );
END;
$function$;
