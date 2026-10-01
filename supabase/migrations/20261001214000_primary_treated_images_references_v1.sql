CREATE OR REPLACE FUNCTION public.nisti_set_product_treatment_v1(
  p_product_id bigint,p_action text,p_processed_image_key text DEFAULT NULL,
  p_processor text DEFAULT NULL,p_processor_version text DEFAULT NULL,p_error_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_product public.products%ROWTYPE; v_row public.mural_product_images%ROWTYPE; v_old_processed text;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_product_id FOR UPDATE;
  IF v_product.id IS NULL OR v_product.image_key IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT processed_image_key INTO v_old_processed FROM public.mural_product_images WHERE product_id=p_product_id;
  IF p_action='review' THEN
    INSERT INTO public.mural_product_images(product_id,source_image_key,processed_image_key,status,processor,
      processor_version,reviewed_by,reviewed_at,error_message,updated_at)
    VALUES(p_product_id,v_product.image_key,p_processed_image_key,'review',p_processor,p_processor_version,NULL,NULL,NULL,now())
    ON CONFLICT(product_id) DO UPDATE SET source_image_key=EXCLUDED.source_image_key,
      processed_image_key=EXCLUDED.processed_image_key,status='review',processor=EXCLUDED.processor,
      processor_version=EXCLUDED.processor_version,reviewed_by=NULL,reviewed_at=NULL,error_message=NULL,updated_at=now();
  ELSIF p_action='approve' THEN
    IF NOT EXISTS(SELECT 1 FROM public.mural_product_images WHERE product_id=p_product_id
      AND processed_image_key IS NOT NULL AND source_image_key=v_product.image_key) THEN
      RETURN jsonb_build_object('status','invalid_derivative');
    END IF;
    UPDATE public.mural_product_images SET status='approved',reviewed_by='admin',reviewed_at=now(),
      error_message=NULL,updated_at=now() WHERE product_id=p_product_id;
  ELSIF p_action='redo' THEN
    INSERT INTO public.mural_product_images(product_id,source_image_key,status,processor,reviewed_by,reviewed_at,error_message,updated_at)
    VALUES(p_product_id,v_product.image_key,'pending','system-precise-redo',NULL,NULL,NULL,now())
    ON CONFLICT(product_id) DO UPDATE SET source_image_key=EXCLUDED.source_image_key,status='pending',
      processor='system-precise-redo',reviewed_by=NULL,reviewed_at=NULL,error_message=NULL,updated_at=now();
  ELSIF p_action='failed' THEN
    INSERT INTO public.mural_product_images(product_id,source_image_key,processed_image_key,status,processor,
      processor_version,reviewed_by,reviewed_at,error_message,updated_at)
    VALUES(p_product_id,v_product.image_key,NULL,'failed',p_processor,p_processor_version,NULL,NULL,left(p_error_message,500),now())
    ON CONFLICT(product_id) DO UPDATE SET source_image_key=EXCLUDED.source_image_key,processed_image_key=NULL,
      status='failed',processor=EXCLUDED.processor,processor_version=EXCLUDED.processor_version,
      reviewed_by=NULL,reviewed_at=NULL,error_message=EXCLUDED.error_message,updated_at=now();
  ELSE RETURN jsonb_build_object('status','invalid_action'); END IF;
  SELECT * INTO v_row FROM public.mural_product_images WHERE product_id=p_product_id;
  RETURN jsonb_build_object('status','ok','old_processed_image_key',v_old_processed,'row',to_jsonb(v_row));
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_list_cover_references_v1(p_capa_code text)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(x) FROM (SELECT r.id,r.capa_code,r.image_key,r.source_product_id,r.reference_kind,r.active,
    r.created_at,r.updated_at,e.embedding_model,e.dimensions,e.updated_at AS embedding_updated_at
    FROM public.cover_visual_references r LEFT JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
    WHERE upper(btrim(r.capa_code))=upper(btrim(p_capa_code)) AND r.active=1
    ORDER BY CASE WHEN r.reference_kind='product' THEN 0 ELSE 1 END,r.id) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_prepare_extra_reference_v1(p_capa_code text,p_image_key text,p_reference_kind text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_code text:=upper(btrim(p_capa_code)); v_ref public.cover_visual_references%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE upper(btrim(capa_code))=v_code) THEN
    RETURN jsonb_build_object('status','cover_not_found');
  END IF;
  IF (SELECT count(*) FROM public.cover_visual_references WHERE upper(btrim(capa_code))=v_code
      AND active=1 AND reference_kind<>'product')>=6 THEN RETURN jsonb_build_object('status','limit_reached'); END IF;
  INSERT INTO public.cover_visual_references(capa_code,image_key,source_product_id,reference_kind,active,updated_at)
  VALUES(v_code,p_image_key,NULL,p_reference_kind,1,now())
  ON CONFLICT(capa_code,image_key) DO UPDATE SET reference_kind=EXCLUDED.reference_kind,active=1,updated_at=now()
  RETURNING * INTO v_ref;
  RETURN jsonb_build_object('status','ok','reference',to_jsonb(v_ref));
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_delete_extra_reference_v1(p_reference_id bigint)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_ref public.cover_visual_references%ROWTYPE;
BEGIN
  SELECT * INTO v_ref FROM public.cover_visual_references WHERE id=p_reference_id AND active=1 FOR UPDATE;
  IF v_ref.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  IF v_ref.reference_kind='product' OR v_ref.source_product_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','protected');
  END IF;
  DELETE FROM public.cover_visual_references WHERE id=p_reference_id;
  RETURN jsonb_build_object('status','ok','reference',to_jsonb(v_ref));
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_set_product_treatment_v1(bigint,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_list_cover_references_v1(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_prepare_extra_reference_v1(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_delete_extra_reference_v1(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_set_product_treatment_v1(bigint,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_list_cover_references_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_prepare_extra_reference_v1(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_delete_extra_reference_v1(bigint) TO service_role;
