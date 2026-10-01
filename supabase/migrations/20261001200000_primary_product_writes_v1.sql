CREATE OR REPLACE FUNCTION public.nisti_upsert_product_primary_v1(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_created boolean := false;
  v_gtin text := NULLIF(btrim(p_row->>'gtin'), '');
  v_platform text := NULLIF(upper(btrim(p_row->>'platform')), '');
  v_link text := NULLIF(btrim(p_row->>'link'), '');
  v_conflict bigint;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE sku = p_row->>'sku' LIMIT 1;

  IF v_gtin IS NOT NULL THEN
    SELECT product_id INTO v_conflict
    FROM public.product_gtins
    WHERE gtin = v_gtin AND active IS TRUE
    LIMIT 1;
    IF v_conflict IS NOT NULL AND v_conflict <> COALESCE(v_product.id, 0) THEN
      RETURN jsonb_build_object('status','gtin_conflict','conflicting_product_id',v_conflict);
    END IF;
  END IF;

  IF v_product.id IS NULL THEN
    INSERT INTO public.products (
      sku,miolo_code,capa_code,acabamento_code,wireo_code,tassel_code,elastico_code,nome,variacao
    ) VALUES (
      p_row->>'sku',p_row->>'miolo_code',p_row->>'capa_code',p_row->>'acabamento_code',
      p_row->>'wireo_code',p_row->>'tassel_code',p_row->>'elastico_code',
      NULLIF(btrim(p_row->>'nome'),''),NULLIF(btrim(p_row->>'variacao'),'')
    ) RETURNING * INTO v_product;
    v_created := true;

    INSERT INTO public.notifications (
      type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
    ) VALUES (
      'new_cover',v_product.capa_code,v_product.id,v_product.sku,v_product.nome,
      v_product.variacao,v_platform,v_product.image_key,now()
    ) ON CONFLICT (capa_code) DO NOTHING;
  ELSE
    UPDATE public.products SET
      miolo_code=p_row->>'miolo_code',capa_code=p_row->>'capa_code',
      acabamento_code=p_row->>'acabamento_code',wireo_code=p_row->>'wireo_code',
      tassel_code=p_row->>'tassel_code',elastico_code=p_row->>'elastico_code',
      nome=COALESCE(NULLIF(btrim(p_row->>'nome'),''),nome),
      variacao=COALESCE(NULLIF(btrim(p_row->>'variacao'),''),variacao),updated_at=now()
    WHERE id=v_product.id RETURNING * INTO v_product;
  END IF;

  IF v_platform IS NOT NULL THEN
    INSERT INTO public.product_platforms(product_id,platform,link)
    VALUES(v_product.id,v_platform,v_link)
    ON CONFLICT(product_id,platform) DO UPDATE SET
      link=COALESCE(EXCLUDED.link,public.product_platforms.link);
  END IF;

  IF v_gtin IS NOT NULL THEN
    INSERT INTO public.product_gtins(product_id,gtin,gtin_type,source,active,updated_at)
    VALUES(v_product.id,v_gtin,'GTIN-13','NISTI',true,now())
    ON CONFLICT(gtin) DO UPDATE SET
      product_id=EXCLUDED.product_id,source='NISTI',active=true,updated_at=now();
  END IF;

  RETURN jsonb_build_object(
    'status','ok','id',v_product.id,'sku',v_product.sku,'capa_code',v_product.capa_code,
    'gtin',v_gtin,'created',v_created,'has_image',v_product.image_key IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_update_product_primary_v1(p_id bigint,p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_product public.products%ROWTYPE; v_platform text;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_id LIMIT 1;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  UPDATE public.products SET
    sku=COALESCE(NULLIF(p_row->>'sku',''),sku),
    miolo_code=COALESCE(NULLIF(p_row->>'miolo_code',''),miolo_code),
    capa_code=COALESCE(NULLIF(p_row->>'capa_code',''),capa_code),
    acabamento_code=COALESCE(NULLIF(p_row->>'acabamento_code',''),acabamento_code),
    wireo_code=COALESCE(NULLIF(p_row->>'wireo_code',''),wireo_code),
    tassel_code=COALESCE(NULLIF(p_row->>'tassel_code',''),tassel_code),
    elastico_code=COALESCE(NULLIF(p_row->>'elastico_code',''),elastico_code),
    nome=CASE WHEN p_row ? 'nome' THEN NULLIF(btrim(p_row->>'nome'),'') ELSE nome END,
    variacao=CASE WHEN p_row ? 'variacao' THEN NULLIF(btrim(p_row->>'variacao'),'') ELSE variacao END,
    updated_at=now()
  WHERE id=p_id;
  IF p_row ? 'platform' THEN
    DELETE FROM public.product_platforms WHERE product_id=p_id;
    v_platform := NULLIF(upper(btrim(p_row->>'platform')),'');
    IF v_platform IS NOT NULL THEN
      INSERT INTO public.product_platforms(product_id,platform,link)
      VALUES(p_id,v_platform,NULLIF(btrim(p_row->>'link'),''));
    END IF;
  END IF;
  RETURN jsonb_build_object('status','ok','id',p_id,'updated',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_finish_product_primary_v1(
  p_id bigint,p_wireo_code text,p_tassel_code text,p_elastico_code text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_product public.products%ROWTYPE; v_acabamento text; v_sku text; v_conflict bigint;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_id LIMIT 1;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  v_acabamento := p_wireo_code || p_tassel_code || p_elastico_code;
  v_sku := v_product.miolo_code || '_' || v_product.capa_code || '_' || v_acabamento;
  SELECT id INTO v_conflict FROM public.products WHERE sku=v_sku AND id<>p_id LIMIT 1;
  IF v_conflict IS NOT NULL THEN RETURN jsonb_build_object('status','sku_conflict','sku',v_sku); END IF;
  UPDATE public.products SET sku=v_sku,acabamento_code=v_acabamento,wireo_code=p_wireo_code,
    tassel_code=p_tassel_code,elastico_code=p_elastico_code,updated_at=now() WHERE id=p_id;
  RETURN jsonb_build_object('status','ok','id',p_id,'old_sku',v_product.sku,'sku',v_sku,
    'acabamento_code',v_acabamento,'wireo_code',p_wireo_code,'tassel_code',p_tassel_code,
    'elastico_code',p_elastico_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_bind_product_gtin_primary_v1(
  p_product_id bigint,p_gtin text,p_source text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_row public.product_gtins%ROWTYPE; v_conflict bigint;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.products WHERE id=p_product_id) THEN
    RETURN jsonb_build_object('status','product_not_found');
  END IF;
  SELECT product_id INTO v_conflict FROM public.product_gtins
    WHERE gtin=p_gtin AND active IS TRUE LIMIT 1;
  IF v_conflict IS NOT NULL AND v_conflict<>p_product_id THEN
    RETURN jsonb_build_object('status','gtin_conflict','conflicting_product_id',v_conflict);
  END IF;
  INSERT INTO public.product_gtins(product_id,gtin,gtin_type,source,active,updated_at)
  VALUES(p_product_id,p_gtin,'GTIN-13',p_source,true,now())
  ON CONFLICT(gtin) DO UPDATE SET product_id=EXCLUDED.product_id,gtin_type='GTIN-13',
    source=EXCLUDED.source,active=true,updated_at=now()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('status','ok','id',v_row.id,'product_id',v_row.product_id,
    'gtin',v_row.gtin,'gtin_type',v_row.gtin_type,'source',v_row.source,'active',v_row.active,
    'created_at',v_row.created_at,'updated_at',v_row.updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_deactivate_product_gtin_primary_v1(p_product_id bigint,p_gtin text)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.product_gtins SET active=false,updated_at=now()
  WHERE product_id=p_product_id AND gtin=p_gtin;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_delete_product_primary_v1(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_product public.products%ROWTYPE; v_processed text; v_refs jsonb;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id=p_id LIMIT 1;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
  SELECT processed_image_key INTO v_processed FROM public.mural_product_images WHERE product_id=p_id;
  SELECT COALESCE(jsonb_agg(image_key),'[]'::jsonb) INTO v_refs
    FROM public.cover_visual_references WHERE source_product_id=p_id;
  DELETE FROM public.cover_visual_references WHERE source_product_id=p_id;
  DELETE FROM public.notifications WHERE product_id=p_id;
  DELETE FROM public.products WHERE id=p_id;
  RETURN jsonb_build_object('status','ok','deleted_id',p_id,'image_key',v_product.image_key,
    'processed_image_key',v_processed,'reference_image_keys',v_refs);
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_upsert_product_primary_v1(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_update_product_primary_v1(bigint,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_finish_product_primary_v1(bigint,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_bind_product_gtin_primary_v1(bigint,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_deactivate_product_gtin_primary_v1(bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_delete_product_primary_v1(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_upsert_product_primary_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_update_product_primary_v1(bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_finish_product_primary_v1(bigint,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_bind_product_gtin_primary_v1(bigint,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_deactivate_product_gtin_primary_v1(bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_delete_product_primary_v1(bigint) TO service_role;
