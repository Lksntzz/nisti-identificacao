-- Permanently retire the legacy AI/visual-recognition data model.
-- Product images, treated Mural images, EAN scans and commerce data are preserved.

CREATE OR REPLACE FUNCTION public.nisti_prepare_product_image_v1(p_product_id bigint, p_image_key text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_old_processed text;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id=p_product_id
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  SELECT processed_image_key INTO v_old_processed
  FROM public.mural_product_images
  WHERE product_id=p_product_id;

  UPDATE public.products
  SET image_key=p_image_key,updated_at=now()
  WHERE id=p_product_id;

  INSERT INTO public.mural_product_images(
    product_id,source_image_key,processed_image_key,status,processor,
    processor_version,reviewed_by,reviewed_at,error_message,updated_at
  )
  VALUES(p_product_id,p_image_key,NULL,'pending',NULL,NULL,NULL,NULL,NULL,now())
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
    'old_image_key',v_product.image_key,
    'old_processed_image_key',v_old_processed
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_delete_product_catalog(p_product_id bigint)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_product_id IS NULL OR p_product_id <= 0 THEN
    RAISE EXCEPTION 'invalid product id';
  END IF;

  DELETE FROM public.notifications WHERE product_id=p_product_id;
  DELETE FROM public.products WHERE id=p_product_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_delete_product_primary_v1(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_processed text;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id=p_id
  FOR UPDATE;

  IF v_product.id IS NULL THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  SELECT processed_image_key INTO v_processed
  FROM public.mural_product_images
  WHERE product_id=p_id;

  DELETE FROM public.notifications WHERE product_id=p_id;
  DELETE FROM public.commerce_nisti_product_links WHERE nisti_product_id=p_id;
  DELETE FROM public.products WHERE id=p_id;

  RETURN jsonb_build_object(
    'status','ok',
    'deleted_id',p_id,
    'image_key',v_product.image_key,
    'processed_image_key',v_processed,
    'reference_image_keys','[]'::jsonb,
    'commerce_link_removed',true
  );
END;
$function$;

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
      LIMIT 1;
    ELSE
      result_key := NULL;
  END CASE;
  RETURN result_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_record_new_cover_notification_v1(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_code text := upper(NULLIF(btrim(p_row->>'capa_code'),''));
  v_id bigint;
  v_created boolean := false;
BEGIN
  IF v_code IS NULL THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.products
    WHERE upper(btrim(capa_code))=v_code
      AND id<>COALESCE(NULLIF(p_row->>'product_id','')::bigint,0)
  ) THEN
    RETURN jsonb_build_object('status','ok','capa_code',v_code,'created',false);
  END IF;

  INSERT INTO public.notifications(
    type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
  )
  VALUES(
    'new_cover',
    v_code,
    NULLIF(p_row->>'product_id','')::bigint,
    NULLIF(btrim(p_row->>'sku'),''),
    NULLIF(btrim(p_row->>'product_name'),''),
    NULLIF(btrim(p_row->>'variacao'),''),
    NULLIF(upper(btrim(p_row->>'platform')),''),
    COALESCE(
      NULLIF(btrim(p_row->>'image_key'),''),
      (
        SELECT image_key
        FROM public.products
        WHERE upper(btrim(capa_code))=v_code AND image_key IS NOT NULL
        ORDER BY id
        LIMIT 1
      )
    ),
    now()
  )
  ON CONFLICT(capa_code) DO NOTHING
  RETURNING id INTO v_id;

  v_created := v_id IS NOT NULL;
  RETURN jsonb_build_object('status','ok','capa_code',v_code,'created',v_created,'id',v_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_system_metrics_core_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'database_size_bytes',pg_database_size(current_database()),
    'products',jsonb_build_object(
      'total',(SELECT count(*) FROM public.products),
      'with_image',(SELECT count(*) FROM public.products WHERE image_key IS NOT NULL)
    )
  )
$function$;

DO $cleanup$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname = ANY(ARRAY[
        'nisti_active_reference_ids_for_product_v1',
        'nisti_active_references',
        'nisti_benchmark_samples_v1',
        'nisti_commit_occurrence_training_v1',
        'nisti_count_pending_visual_references_v1',
        'nisti_cover_index_v1',
        'nisti_create_scan_occurrence_v1',
        'nisti_delete_extra_reference_v1',
        'nisti_delete_visual_reference',
        'nisti_dismiss_scan_occurrence_v1',
        'nisti_geometric_shadow_by_token_v1',
        'nisti_geometric_shadow_observability_v1',
        'nisti_geometric_shadow_summary_rows_v1',
        'nisti_list_cover_references_v1',
        'nisti_mirror_confirm_geometric_shadow',
        'nisti_mirror_geometric_shadow_evidence',
        'nisti_mirror_link_geometric_shadow',
        'nisti_mirror_operator_name',
        'nisti_mirror_recognition_event',
        'nisti_mirror_scan_occurrence',
        'nisti_mirror_visual_reference',
        'nisti_mirror_visual_references_batch',
        'nisti_operator_stats_v1',
        'nisti_pending_visual_references_v1',
        'nisti_platforms_for_reference',
        'nisti_prepare_extra_reference_v1',
        'nisti_prepare_occurrence_training_v1',
        'nisti_recognition_events_v1',
        'nisti_recognition_metrics_v1',
        'nisti_reconcile_trained_shadow_v1',
        'nisti_record_geometric_shadow_evidence_v1',
        'nisti_record_recognition_event_v1',
        'nisti_reference_by_cover',
        'nisti_reference_by_id',
        'nisti_reserve_occurrences_v1',
        'nisti_store_reference_embedding_v1',
        'nisti_trained_references_v1',
        'nisti_upsert_reference_embedding_v1',
        'nisti_vectorize_reference_rows_v1',
        'nisti_vectorize_reference_v1',
        'nisti_vectorize_status_v1'
      ])
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s',r.oid::regprocedure);
  END LOOP;
END;
$cleanup$;

DROP TABLE IF EXISTS public.scan_occurrence_candidates CASCADE;
DROP TABLE IF EXISTS public.scan_occurrence_review_sessions CASCADE;
DROP TABLE IF EXISTS public.geometric_shadow_evidence CASCADE;
DROP TABLE IF EXISTS public.recognition_events CASCADE;
DROP TABLE IF EXISTS public.recognition_daily CASCADE;
DROP TABLE IF EXISTS public.cover_visual_signatures CASCADE;
DROP TABLE IF EXISTS public.cover_reference_embeddings CASCADE;
DROP TABLE IF EXISTS public.cover_embeddings CASCADE;
DROP TABLE IF EXISTS public.scan_occurrences CASCADE;
DROP TABLE IF EXISTS public.cover_visual_references CASCADE;
