-- Temporary direct GTIN lookup introduced while removing the scanner's D1 dependency.
-- Kept in migration history for parity with production; superseded by the Edge Function hardening migration.

CREATE OR REPLACE FUNCTION public.nisti_public_gtin_lookup_v1(p_gtin text)
RETURNS TABLE (
  gtin text,
  gtin_type text,
  source text,
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
  image_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    g.gtin,
    g.gtin_type,
    g.source,
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
    p.image_key
  FROM public.product_gtins g
  INNER JOIN public.products p ON p.id = g.product_id
  WHERE btrim(coalesce(p_gtin, '')) ~ '^[0-9]{13}$'
    AND g.gtin = btrim(p_gtin)
    AND g.active = true
  ORDER BY g.id ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.nisti_public_gtin_lookup_v1(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nisti_public_gtin_lookup_v1(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_public_gtin_lookup_v1(text) TO anon, authenticated, service_role;
