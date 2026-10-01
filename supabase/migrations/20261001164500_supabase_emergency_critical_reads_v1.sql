-- NISTI emergency reserve reads — critical operational surfaces.
-- D1 remains the primary database. These RPCs are only used when D1 reports
-- the daily row-read quota error and the emergency reserve flag is enabled.

CREATE OR REPLACE FUNCTION public.nisti_reserve_gtin_lookup_v1(p_gtin text)
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
  image_key text,
  platforms jsonb
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
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
    p.image_key,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'platform', pp.platform,
          'link', pp.link
        )
        ORDER BY pp.id ASC
      )
      FROM public.product_platforms pp
      WHERE pp.product_id=p.id
    ), '[]'::jsonb) AS platforms
  FROM public.product_gtins g
  INNER JOIN public.products p ON p.id=g.product_id
  WHERE g.gtin=p_gtin
    AND g.active=true
  ORDER BY g.id ASC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_gtin_lookup_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_gtin_lookup_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_product_gtins_v1(p_product_id bigint)
RETURNS TABLE (
  id bigint,
  product_id bigint,
  gtin text,
  gtin_type text,
  source text,
  active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    g.id,
    g.product_id,
    g.gtin,
    g.gtin_type,
    g.source,
    g.active,
    g.created_at,
    g.updated_at
  FROM public.product_gtins g
  WHERE g.product_id=p_product_id
  ORDER BY g.active DESC,g.id ASC;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_product_gtins_v1(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_product_gtins_v1(bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_occurrences_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'stats', jsonb_build_object(
      'pending', (SELECT COUNT(*) FROM public.scan_occurrences WHERE status='pending'),
      'trained', (SELECT COUNT(*) FROM public.scan_occurrences WHERE status='trained'),
      'dismissed', (SELECT COUNT(*) FROM public.scan_occurrences WHERE status='dismissed')
    ),
    'occurrences', COALESCE((
      SELECT jsonb_agg(to_jsonb(item) ORDER BY item.created_at DESC)
      FROM (
        SELECT
          o.id,
          o.image_key,
          o.platform,
          o.suggested_capa_code,
          o.confidence,
          o.error_reason,
          o.operator_name,
          o.operator_id,
          o.status,
          o.created_at
        FROM public.scan_occurrences o
        WHERE o.status='pending'
        ORDER BY o.created_at DESC
        LIMIT 60
      ) item
    ), '[]'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_occurrences_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_occurrences_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_notifications_v1(
  p_user_id text,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id bigint,
  type text,
  capa_code text,
  product_id bigint,
  sku text,
  product_name text,
  variacao text,
  platform text,
  image_key text,
  created_at timestamptz,
  is_read boolean,
  read_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    n.id,
    n.type,
    n.capa_code,
    n.product_id,
    n.sku,
    n.product_name,
    n.variacao,
    n.platform,
    n.image_key,
    n.created_at,
    (r.read_at IS NOT NULL) AS is_read,
    r.read_at
  FROM public.notifications n
  LEFT JOIN public.notification_reads r
    ON r.notification_id=n.id
   AND r.user_id=LEFT(COALESCE(NULLIF(BTRIM(p_user_id),''),'anonymous'),100)
  ORDER BY n.id DESC
  LIMIT GREATEST(1,LEAST(100,COALESCE(p_limit,50)));
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_notifications_v1(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_notifications_v1(text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_unread_notifications_v1(p_user_id text)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::bigint
  FROM public.notifications n
  LEFT JOIN public.notification_reads r
    ON r.notification_id=n.id
   AND r.user_id=LEFT(COALESCE(NULLIF(BTRIM(p_user_id),''),'anonymous'),100)
  WHERE r.id IS NULL;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_unread_notifications_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_unread_notifications_v1(text) TO service_role;
