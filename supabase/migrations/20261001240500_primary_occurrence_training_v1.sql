CREATE OR REPLACE FUNCTION public.nisti_prepare_occurrence_training_v1(
  p_occurrence_id bigint,
  p_capa_code text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_occ public.scan_occurrences%ROWTYPE;
  v_code text:=upper(BTRIM(COALESCE(p_capa_code,'')));
  v_reference_id bigint;
  v_existing boolean:=false;
BEGIN
  IF p_occurrence_id IS NULL OR p_occurrence_id<=0 OR v_code='' THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  SELECT * INTO v_occ
  FROM public.scan_occurrences
  WHERE id=p_occurrence_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  SELECT id INTO v_reference_id
  FROM public.cover_visual_references
  WHERE upper(BTRIM(capa_code))=v_code
    AND image_key=v_occ.image_key
  ORDER BY id
  LIMIT 1;

  IF v_reference_id IS NOT NULL THEN
    v_existing:=true;
  ELSE
    v_reference_id:=nextval(pg_get_serial_sequence('public.cover_visual_references','id'));
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'occurrence_id',v_occ.id,
    'image_key',v_occ.image_key,
    'platform',v_occ.platform,
    'reference_id',v_reference_id,
    'reference_exists',v_existing,
    'capa_code',v_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_commit_occurrence_training_v1(
  p_occurrence_id bigint,
  p_reference_id bigint,
  p_capa_code text,
  p_embedding_model text,
  p_dimensions integer,
  p_embedding_json text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_occ public.scan_occurrences%ROWTYPE;
  v_code text:=upper(BTRIM(COALESCE(p_capa_code,'')));
  v_actual_reference_id bigint;
BEGIN
  IF p_occurrence_id IS NULL OR p_occurrence_id<=0
     OR p_reference_id IS NULL OR p_reference_id<=0
     OR v_code=''
     OR NULLIF(BTRIM(p_embedding_model),'') IS NULL
     OR COALESCE(p_dimensions,0)<=0
     OR NULLIF(BTRIM(p_embedding_json),'') IS NULL THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  SELECT * INTO v_occ
  FROM public.scan_occurrences
  WHERE id=p_occurrence_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status','not_found');
  END IF;

  INSERT INTO public.cover_visual_references(
    id,capa_code,image_key,source_product_id,reference_kind,active,updated_at
  ) VALUES(
    p_reference_id,v_code,v_occ.image_key,NULL,'real_scan',1,now()
  )
  ON CONFLICT(capa_code,image_key) DO UPDATE SET
    reference_kind='real_scan',active=1,updated_at=now()
  RETURNING id INTO v_actual_reference_id;

  IF v_actual_reference_id<>p_reference_id THEN
    RAISE EXCEPTION 'reference id race during occurrence training'
      USING ERRCODE='40001';
  END IF;

  INSERT INTO public.cover_reference_embeddings(
    reference_id,embedding_model,dimensions,embedding_json,updated_at
  ) VALUES(
    p_reference_id,BTRIM(p_embedding_model),p_dimensions,p_embedding_json,now()
  )
  ON CONFLICT(reference_id) DO UPDATE SET
    embedding_model=EXCLUDED.embedding_model,
    dimensions=EXCLUDED.dimensions,
    embedding_json=EXCLUDED.embedding_json,
    updated_at=now();

  UPDATE public.scan_occurrences
  SET status='trained',trained_capa_code=v_code,trained_at=now()
  WHERE id=p_occurrence_id;

  RETURN jsonb_build_object(
    'status','ok',
    'occurrence_id',p_occurrence_id,
    'reference_id',p_reference_id,
    'capa_code',v_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_prepare_occurrence_training_v1(bigint,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_commit_occurrence_training_v1(bigint,bigint,text,text,integer,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_prepare_occurrence_training_v1(bigint,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_commit_occurrence_training_v1(bigint,bigint,text,text,integer,text)
  TO service_role;
