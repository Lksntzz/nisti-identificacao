CREATE OR REPLACE FUNCTION public.nisti_prepare_product_image_v1(p_product_id bigint,p_image_key text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_product public.products%ROWTYPE; v_old_processed text; v_reference public.cover_visual_references%ROWTYPE;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT processed_image_key INTO v_old_processed FROM public.mural_product_images WHERE product_id=p_product_id;
  UPDATE public.products SET image_key=p_image_key,updated_at=now() WHERE id=p_product_id;
  INSERT INTO public.mural_product_images(product_id,source_image_key,processed_image_key,status,processor,
    processor_version,reviewed_by,reviewed_at,error_message,updated_at)
  VALUES(p_product_id,p_image_key,NULL,'pending',NULL,NULL,NULL,NULL,NULL,now())
  ON CONFLICT(product_id) DO UPDATE SET source_image_key=EXCLUDED.source_image_key,
    processed_image_key=NULL,status='pending',processor=NULL,processor_version=NULL,
    reviewed_by=NULL,reviewed_at=NULL,error_message=NULL,updated_at=now();
  INSERT INTO public.cover_visual_references(capa_code,image_key,source_product_id,reference_kind,active,updated_at)
  VALUES(upper(btrim(v_product.capa_code)),p_image_key,p_product_id,'product',1,now())
  ON CONFLICT(capa_code,image_key) DO UPDATE SET source_product_id=EXCLUDED.source_product_id,
    reference_kind='product',active=1,updated_at=now() RETURNING * INTO v_reference;
  RETURN jsonb_build_object('status','ok','old_image_key',v_product.image_key,
    'old_processed_image_key',v_old_processed,'reference',to_jsonb(v_reference));
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_store_reference_embedding_v1(
  p_reference_id bigint,p_embedding_model text,p_dimensions integer,p_embedding_json text,
  p_cleanup_product_id bigint DEFAULT NULL,p_keep_image_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_removed jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.cover_visual_references WHERE id=p_reference_id AND active=1) THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;
  INSERT INTO public.cover_reference_embeddings(reference_id,embedding_model,dimensions,embedding_json,updated_at)
  VALUES(p_reference_id,p_embedding_model,p_dimensions,p_embedding_json,now())
  ON CONFLICT(reference_id) DO UPDATE SET embedding_model=EXCLUDED.embedding_model,
    dimensions=EXCLUDED.dimensions,embedding_json=EXCLUDED.embedding_json,updated_at=now();
  IF p_cleanup_product_id IS NOT NULL AND p_keep_image_key IS NOT NULL THEN
    WITH deleted AS (
      DELETE FROM public.cover_visual_references
      WHERE source_product_id=p_cleanup_product_id AND image_key<>p_keep_image_key
      RETURNING id,image_key
    ) SELECT COALESCE(jsonb_agg(to_jsonb(deleted)),'[]'::jsonb) INTO v_removed FROM deleted;
  END IF;
  RETURN jsonb_build_object('status','ok','removed_references',v_removed);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_product_image_context_v1(p_product_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT jsonb_build_object('status','ok','id',p.id,'capa_code',p.capa_code,
    'image_key',p.image_key,'source_image_key',mpi.source_image_key,
    'processed_image_key',mpi.processed_image_key,'treatment_status',mpi.status,
    'processor',mpi.processor,'processor_version',mpi.processor_version,'reviewed_by',mpi.reviewed_by)
    FROM public.products p LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.id=p_product_id),'{"status":"not_found"}'::jsonb)
$$;

REVOKE ALL ON FUNCTION public.nisti_prepare_product_image_v1(bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_store_reference_embedding_v1(bigint,text,integer,text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_product_image_context_v1(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_prepare_product_image_v1(bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_store_reference_embedding_v1(bigint,text,integer,text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_product_image_context_v1(bigint) TO service_role;
