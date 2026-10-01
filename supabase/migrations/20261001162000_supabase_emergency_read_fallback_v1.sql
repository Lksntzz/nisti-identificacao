-- Emergency read fallback for D1 daily row-read exhaustion.
-- Supabase remains reserve-only; this RPC exposes the catalog snapshot already mirrored here.

CREATE OR REPLACE FUNCTION public.nisti_reserve_products_v1()
RETURNS TABLE (
  id bigint,
  sku text,
  miolo_code text,
  capa_code text,
  acabamento_code text,
  wireo_code text,
  tassel_code text,
  elastico_code text,
  nome text,
  variacao text,
  image_key text,
  created_at timestamptz,
  treated_source_image_key text,
  treated_image_key text,
  treated_image_status text,
  treated_image_processor text,
  treated_image_version text,
  treated_image_reviewed_by text,
  platform text,
  link text,
  gtin text,
  has_active_gtin boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    p.id,
    p.sku,
    p.miolo_code,
    p.capa_code,
    p.acabamento_code,
    p.wireo_code,
    p.tassel_code,
    p.elastico_code,
    p.nome,
    p.variacao,
    p.image_key,
    p.created_at,
    mpi.source_image_key AS treated_source_image_key,
    mpi.processed_image_key AS treated_image_key,
    mpi.status AS treated_image_status,
    mpi.processor AS treated_image_processor,
    mpi.processor_version AS treated_image_version,
    mpi.reviewed_by AS treated_image_reviewed_by,
    (
      SELECT pp.platform
      FROM public.product_platforms pp
      WHERE pp.product_id=p.id
      ORDER BY pp.id ASC
      LIMIT 1
    ) AS platform,
    (
      SELECT pp.link
      FROM public.product_platforms pp
      WHERE pp.product_id=p.id
      ORDER BY pp.id ASC
      LIMIT 1
    ) AS link,
    (
      SELECT pg.gtin
      FROM public.product_gtins pg
      WHERE pg.product_id=p.id AND pg.active=true
      ORDER BY pg.id ASC
      LIMIT 1
    ) AS gtin,
    EXISTS(
      SELECT 1
      FROM public.product_gtins pg
      WHERE pg.product_id=p.id AND pg.active=true
    ) AS has_active_gtin
  FROM public.products p
  LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
  ORDER BY p.id DESC
  LIMIT 1000;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_products_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_products_v1() TO service_role;
