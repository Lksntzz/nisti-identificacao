-- Product upsert returns the atomic result of the unique new-cover notification insert.
-- The Worker only schedules push when this returned event id is non-null,
-- avoiding one notification per SKU variant of the same cover.
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
  v_notification_id bigint;
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
    ) ON CONFLICT (capa_code) DO NOTHING
    RETURNING id INTO v_notification_id;
  ELSE
    UPDATE public.products SET
      miolo_code=p_row->>'miolo_code',capa_code=p_row->>'capa_code',
      acabamento_code=p_row->>'acabamento_code',wireo_code=p_row->>'wireo_code',
      tassel_code=p_row->>'tassel_code',elastico_code=p_row->>'elastico_code',
      nome=COALESCE(NULLIF(btrim(p_row->>'nome'),''),nome),
      variacao=COALESCE(NULLIF(btrim(p_row->>'variacao'),''),variacao),updated_at=now()
    WHERE id=v_product.id RETURNING * INTO v_product;

    -- Editing an existing SKU into an unseen cover also emits one cover event.
    INSERT INTO public.notifications (
      type,capa_code,product_id,sku,product_name,variacao,platform,image_key,created_at
    ) VALUES (
      'new_cover',v_product.capa_code,v_product.id,v_product.sku,v_product.nome,
      v_product.variacao,v_platform,v_product.image_key,now()
    ) ON CONFLICT (capa_code) DO NOTHING
    RETURNING id INTO v_notification_id;
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
    'gtin',v_gtin,'created',v_created,'has_image',v_product.image_key IS NOT NULL,
    'cover_notification_created',v_notification_id IS NOT NULL,
    'cover_notification_id',v_notification_id
  );
END;
$$;


REVOKE ALL ON FUNCTION public.nisti_upsert_product_primary_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_upsert_product_primary_v1(jsonb) TO service_role;
