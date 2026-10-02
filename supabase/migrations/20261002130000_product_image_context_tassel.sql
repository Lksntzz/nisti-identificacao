-- Expose the registered tassel only to the server-side image-treatment context.
-- Public client roles remain unable to execute this RPC.
CREATE OR REPLACE FUNCTION public.nisti_product_image_context_v1(p_product_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT jsonb_build_object(
    'status','ok','id',p.id,'capa_code',p.capa_code,'tassel_code',p.tassel_code,
    'image_key',p.image_key,'source_image_key',mpi.source_image_key,
    'processed_image_key',mpi.processed_image_key,'treatment_status',mpi.status,
    'processor',mpi.processor,'processor_version',mpi.processor_version,'reviewed_by',mpi.reviewed_by)
    FROM public.products p LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE p.id=p_product_id),'{"status":"not_found"}'::jsonb)
$$;

REVOKE ALL ON FUNCTION public.nisti_product_image_context_v1(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_product_image_context_v1(bigint) TO service_role;
