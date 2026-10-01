-- A deleted NISTI product must not leave a stale NISTI→Commerce synchronization link.

CREATE OR REPLACE FUNCTION public.nisti_delete_product_primary_v1(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_processed text;
  v_refs jsonb;
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

  SELECT COALESCE(jsonb_agg(image_key),'[]'::jsonb) INTO v_refs
  FROM public.cover_visual_references
  WHERE source_product_id=p_id;

  DELETE FROM public.cover_visual_references
  WHERE source_product_id=p_id;

  DELETE FROM public.notifications
  WHERE product_id=p_id;

  DELETE FROM public.commerce_nisti_product_links
  WHERE nisti_product_id=p_id;

  DELETE FROM public.products
  WHERE id=p_id;

  RETURN jsonb_build_object(
    'status','ok',
    'deleted_id',p_id,
    'image_key',v_product.image_key,
    'processed_image_key',v_processed,
    'reference_image_keys',v_refs,
    'commerce_link_removed',true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_delete_product_primary_v1(bigint)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_delete_product_primary_v1(bigint)
  TO service_role;
