-- Add generic Mural reference readers before retiring Gemini-named compatibility RPCs.
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

REVOKE ALL ON FUNCTION public.nisti_admin_mural_product_reference_v1(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_collection_reference_v1(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_product_reference_v1(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_collection_reference_v1(bigint) TO service_role;
