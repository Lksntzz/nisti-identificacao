-- Persist one auditable cutout mask per product without changing approved treated images.

ALTER TABLE public.mural_product_images
  ADD COLUMN IF NOT EXISTS mask_image_key text,
  ADD COLUMN IF NOT EXISTS mask_processor_version text,
  ADD COLUMN IF NOT EXISTS mask_created_at timestamptz;

CREATE OR REPLACE FUNCTION public.nisti_set_product_treatment_v2(
  p_product_id bigint,
  p_action text,
  p_processed_image_key text DEFAULT NULL,
  p_mask_image_key text DEFAULT NULL,
  p_processor text DEFAULT NULL,
  p_processor_version text DEFAULT NULL,
  p_error_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
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
    IF p_processed_image_key IS NULL OR p_mask_image_key IS NULL THEN
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
        AND processed_image_key IS NOT NULL
        AND source_image_key=v_product.image_key
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
$$;

CREATE OR REPLACE FUNCTION public.nisti_set_product_mask_v1(
  p_product_id bigint,
  p_mask_image_key text,
  p_processor_version text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_row public.mural_product_images%ROWTYPE;
  v_old_mask text;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF v_product.id IS NULL OR v_product.image_key IS NULL THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;
  IF NULLIF(BTRIM(COALESCE(p_mask_image_key,'')),'') IS NULL THEN
    RETURN jsonb_build_object('status','invalid_mask');
  END IF;

  SELECT * INTO v_row FROM public.mural_product_images WHERE product_id=p_product_id;
  IF v_row.product_id IS NULL THEN
    INSERT INTO public.mural_product_images(
      product_id,source_image_key,mask_image_key,mask_processor_version,mask_created_at,status,updated_at
    )
    VALUES(p_product_id,v_product.image_key,p_mask_image_key,p_processor_version,now(),'pending',now());
  ELSIF v_row.source_image_key IS DISTINCT FROM v_product.image_key THEN
    RETURN jsonb_build_object('status','source_mismatch');
  ELSE
    v_old_mask := v_row.mask_image_key;
    UPDATE public.mural_product_images
    SET mask_image_key=p_mask_image_key,
        mask_processor_version=p_processor_version,
        mask_created_at=now(),
        updated_at=now()
    WHERE product_id=p_product_id;
  END IF;

  SELECT * INTO v_row FROM public.mural_product_images WHERE product_id=p_product_id;
  RETURN jsonb_build_object('status','ok','old_mask_image_key',v_old_mask,'row',to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_product_mask_queue_v1(
  p_processor_version text DEFAULT '11',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      COALESCE(NULLIF(BTRIM(p_processor_version),''),'11') AS current_version,
      GREATEST(1,LEAST(COALESCE(p_limit,20),100)) AS page_limit,
      GREATEST(COALESCE(p_offset,0),0) AS page_offset
  ),
  base AS (
    SELECT
      p.id,p.sku,p.nome,p.tassel_code,p.image_key,
      mpi.status,mpi.source_image_key,mpi.mask_image_key,mpi.mask_processor_version
    FROM public.products p
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.image_key IS NOT NULL
      AND (
        mpi.mask_image_key IS NULL
        OR mpi.source_image_key IS DISTINCT FROM p.image_key
        OR COALESCE(mpi.mask_processor_version,'')<>(SELECT current_version FROM params)
      )
  ),
  paged AS (
    SELECT * FROM base
    ORDER BY id
    LIMIT (SELECT page_limit FROM params)
    OFFSET (SELECT page_offset FROM params)
  )
  SELECT jsonb_build_object(
    'total',(SELECT COUNT(*) FROM base),
    'limit',(SELECT page_limit FROM params),
    'offset',(SELECT page_offset FROM params),
    'items',COALESCE((SELECT jsonb_agg(to_jsonb(paged) ORDER BY id) FROM paged),'[]'::jsonb)
  )
$$;

CREATE OR REPLACE FUNCTION public.nisti_product_image_context_v1(p_product_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT jsonb_build_object(
    'status','ok','id',p.id,'capa_code',p.capa_code,'tassel_code',p.tassel_code,
    'image_key',p.image_key,'source_image_key',mpi.source_image_key,
    'processed_image_key',mpi.processed_image_key,'mask_image_key',mpi.mask_image_key,
    'mask_processor_version',mpi.mask_processor_version,'mask_created_at',mpi.mask_created_at,
    'treatment_status',mpi.status,'processor',mpi.processor,
    'processor_version',mpi.processor_version,'reviewed_by',mpi.reviewed_by)
    FROM public.products p LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.id=p_product_id),'{"status":"not_found"}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION public.nisti_prepare_product_image_v1(p_product_id bigint, p_image_key text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_old_processed text;
  v_old_mask text;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;

  SELECT processed_image_key,mask_image_key INTO v_old_processed,v_old_mask
  FROM public.mural_product_images WHERE product_id=p_product_id;

  UPDATE public.products SET image_key=p_image_key,updated_at=now() WHERE id=p_product_id;

  INSERT INTO public.mural_product_images(
    product_id,source_image_key,processed_image_key,mask_image_key,mask_processor_version,mask_created_at,
    status,processor,processor_version,reviewed_by,reviewed_at,error_message,updated_at
  )
  VALUES(p_product_id,p_image_key,NULL,NULL,NULL,NULL,'pending',NULL,NULL,NULL,NULL,NULL,now())
  ON CONFLICT(product_id) DO UPDATE SET
    source_image_key=EXCLUDED.source_image_key,
    processed_image_key=NULL,
    mask_image_key=NULL,
    mask_processor_version=NULL,
    mask_created_at=NULL,
    status='pending',processor=NULL,processor_version=NULL,
    reviewed_by=NULL,reviewed_at=NULL,error_message=NULL,updated_at=now();

  RETURN jsonb_build_object(
    'status','ok',
    'old_image_key',v_product.image_key,
    'old_processed_image_key',v_old_processed,
    'old_mask_image_key',v_old_mask
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_delete_product_primary_v1(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_processed text;
  v_mask text;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_id FOR UPDATE;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;

  SELECT processed_image_key,mask_image_key INTO v_processed,v_mask
  FROM public.mural_product_images WHERE product_id=p_id;

  DELETE FROM public.notifications WHERE product_id=p_id;
  DELETE FROM public.commerce_nisti_product_links WHERE nisti_product_id=p_id;
  DELETE FROM public.products WHERE id=p_id;

  RETURN jsonb_build_object(
    'status','ok','deleted_id',p_id,
    'image_key',v_product.image_key,
    'processed_image_key',v_processed,
    'mask_image_key',v_mask,
    'reference_image_keys','[]'::jsonb,
    'commerce_link_removed',true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_set_product_treatment_v2(bigint,text,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_set_product_mask_v1(bigint,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_product_mask_queue_v1(text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_set_product_treatment_v2(bigint,text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_set_product_mask_v1(bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_product_mask_queue_v1(text,integer,integer) TO service_role;
