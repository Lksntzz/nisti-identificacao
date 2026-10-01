-- Move active Admin metrics/log reads to Supabase so D1 is no longer required by the health pages.

CREATE OR REPLACE FUNCTION public.nisti_recognition_events_v1(
  p_limit integer DEFAULT 100,
  p_kind text DEFAULT NULL,
  p_issues_only boolean DEFAULT false,
  p_operator_name text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id DESC),'[]'::jsonb)
  FROM (
    SELECT e.*,p.image_key
    FROM public.recognition_events e
    LEFT JOIN public.products p ON p.id=e.product_id
    WHERE (
      COALESCE(p_issues_only,false)
      AND e.kind IN ('unmatched','system_error')
    ) OR (
      NOT COALESCE(p_issues_only,false)
      AND (
        NULLIF(BTRIM(COALESCE(p_kind,'')),'') IS NULL
        OR e.kind=BTRIM(p_kind)
      )
    )
    AND (
      NULLIF(BTRIM(COALESCE(p_operator_name,'')),'') IS NULL
      OR e.operator_name=BTRIM(p_operator_name)
    )
    ORDER BY e.id DESC
    LIMIT GREATEST(1,LEAST(COALESCE(p_limit,100),200))
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_stats_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'operator_name',operator_name,
      'operator_id',operator_id,
      'total_attempts',total_attempts,
      'successes',successes,
      'unmatched',unmatched,
      'system_errors',system_errors,
      'success_rate',CASE WHEN total_attempts>0 THEN round((successes::numeric/total_attempts::numeric)*100)::integer ELSE 0 END,
      'last_seen_at',last_seen_at
    )
    ORDER BY last_seen_at DESC
  ),'[]'::jsonb)
  FROM (
    SELECT
      COALESCE(NULLIF(BTRIM(operator_name),''),'Operador Geral') AS operator_name,
      max(operator_id) AS operator_id,
      count(*)::bigint AS total_attempts,
      count(*) FILTER (WHERE kind='success')::bigint AS successes,
      count(*) FILTER (WHERE kind='unmatched')::bigint AS unmatched,
      count(*) FILTER (WHERE kind='system_error')::bigint AS system_errors,
      max(created_at) AS last_seen_at
    FROM public.recognition_events
    GROUP BY COALESCE(NULLIF(BTRIM(operator_name),''),'Operador Geral')
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_recognition_metrics_v1(p_day text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  WITH today_row AS (
    SELECT *
    FROM public.recognition_daily
    WHERE day=p_day
    LIMIT 1
  ),
  totals AS (
    SELECT
      COALESCE(sum(attempts),0)::bigint AS attempts,
      COALESCE(sum(successes),0)::bigint AS successes,
      COALESCE(sum(unmatched),0)::bigint AS unmatched,
      COALESCE(sum(system_errors),0)::bigint AS system_errors,
      COALESCE(sum(embedding_requests),0)::bigint AS embedding_requests,
      COALESCE(sum(generation_requests),0)::bigint AS generation_requests,
      COALESCE(sum(total_ms),0)::bigint AS total_ms
    FROM public.recognition_daily
  ),
  first_day AS (
    SELECT min(day) AS day FROM public.recognition_daily WHERE attempts>0
  ),
  latest_error AS (
    SELECT last_error_at,last_error_message
    FROM public.recognition_daily
    WHERE last_error_at IS NOT NULL
    ORDER BY day DESC
    LIMIT 1
  ),
  latest_success AS (
    SELECT last_success_at
    FROM public.recognition_daily
    WHERE last_success_at IS NOT NULL
    ORDER BY day DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'timezone','America/Sao_Paulo',
    'monitoring_started_on',COALESCE((SELECT day FROM first_day),p_day),
    'today',jsonb_build_object(
      'attempts',COALESCE((SELECT attempts FROM today_row),0),
      'successes',COALESCE((SELECT successes FROM today_row),0),
      'unmatched',COALESCE((SELECT unmatched FROM today_row),0),
      'system_errors',COALESCE((SELECT system_errors FROM today_row),0),
      'embedding_requests',COALESCE((SELECT embedding_requests FROM today_row),0),
      'generation_requests',COALESCE((SELECT generation_requests FROM today_row),0),
      'total_ms',COALESCE((SELECT total_ms FROM today_row),0),
      'last_success_at',(SELECT last_success_at FROM today_row),
      'last_unmatched_at',(SELECT last_unmatched_at FROM today_row),
      'last_error_at',(SELECT last_error_at FROM today_row),
      'last_error_message',(SELECT last_error_message FROM today_row)
    ),
    'since_monitoring',(SELECT to_jsonb(totals) FROM totals),
    'average_ms_today',CASE
      WHEN COALESCE((SELECT attempts FROM today_row),0)>0
      THEN round(COALESCE((SELECT total_ms FROM today_row),0)::numeric/(SELECT attempts FROM today_row))::bigint
      ELSE 0
    END,
    'latest_success_at',(SELECT last_success_at FROM latest_success),
    'latest_error_at',(SELECT last_error_at FROM latest_error),
    'latest_error_message',(SELECT last_error_message FROM latest_error)
  )
$$;

CREATE OR REPLACE FUNCTION public.nisti_system_metrics_core_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  WITH product_stats AS (
    SELECT count(*)::bigint AS total,count(*) FILTER (WHERE image_key IS NOT NULL)::bigint AS with_image
    FROM public.products
  ),
  reference_stats AS (
    SELECT
      count(*)::bigint AS references_total,
      count(*) FILTER (WHERE e.reference_id IS NOT NULL)::bigint AS indexed_total,
      count(DISTINCT r.capa_code) FILTER (WHERE e.reference_id IS NOT NULL)::bigint AS indexed_covers
    FROM public.cover_visual_references r
    LEFT JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.active=1
  ),
  embedding_activity AS (
    SELECT
      count(*)::bigint AS embeddings_updated_today,
      count(DISTINCT reference_id)::bigint AS references_updated_today
    FROM public.cover_reference_embeddings
    WHERE (updated_at AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date
  ),
  indexed_refs AS (
    SELECT r.id,r.capa_code,r.source_product_id
    FROM public.cover_visual_references r
    JOIN public.cover_reference_embeddings e ON e.reference_id=r.id
    WHERE r.active=1
  ),
  product_platform_counts AS (
    SELECT pp.product_id,count(DISTINCT upper(BTRIM(pp.platform)))::bigint AS platform_count
    FROM public.product_platforms pp
    WHERE upper(BTRIM(pp.platform)) IN ('MERCADO LIVRE','SHOPEE','AMAZON')
    GROUP BY pp.product_id
  ),
  cover_platform_counts AS (
    SELECT upper(BTRIM(p.capa_code)) AS capa_code,count(DISTINCT upper(BTRIM(pp.platform)))::bigint AS platform_count
    FROM public.products p
    JOIN public.product_platforms pp ON pp.product_id=p.id
    WHERE upper(BTRIM(pp.platform)) IN ('MERCADO LIVRE','SHOPEE','AMAZON')
    GROUP BY upper(BTRIM(p.capa_code))
  ),
  resolved AS (
    SELECT r.id,
      CASE
        WHEN r.source_product_id IS NOT NULL THEN COALESCE(ps.platform_count,0)
        ELSE COALESCE(cs.platform_count,0)
      END AS platform_count
    FROM indexed_refs r
    LEFT JOIN product_platform_counts ps ON ps.product_id=r.source_product_id
    LEFT JOIN cover_platform_counts cs ON cs.capa_code=upper(BTRIM(r.capa_code))
  ),
  vector_state AS (
    SELECT
      count(*)::bigint AS indexed_references,
      COALESCE(sum(CASE WHEN platform_count>0 THEN platform_count ELSE 3 END),0)::bigint AS expected_vector_copies
    FROM resolved
  )
  SELECT jsonb_build_object(
    'database_size_bytes',pg_database_size(current_database()),
    'products',(SELECT to_jsonb(product_stats) FROM product_stats),
    'references',(SELECT to_jsonb(reference_stats) FROM reference_stats),
    'embedding_activity',(SELECT to_jsonb(embedding_activity) FROM embedding_activity),
    'vectorize',jsonb_build_object(
      'indexed_references',(SELECT indexed_references FROM vector_state),
      'expected_vector_copies',(SELECT expected_vector_copies FROM vector_state),
      'dimensions_per_vector',768,
      'expected_stored_dimensions',(SELECT expected_vector_copies FROM vector_state)*768,
      'measurement','derived_from_supabase_platform_scope',
      'exact_provider_usage',false,
      'note','Estimativa do estado que o NISTI espera no Vectorize. O uso real da conta exige Analytics da Cloudflare.'
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.nisti_system_health_core_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT jsonb_build_object(
    'products',(SELECT count(*) FROM public.products),
    'technical_errors_today',(
      SELECT count(*)
      FROM public.gtin_scan_events
      WHERE status='system_error'
        AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date=(now() AT TIME ZONE 'America/Sao_Paulo')::date
    ),
    'last_error_at',(
      SELECT max(created_at) FROM public.gtin_scan_events WHERE status='system_error'
    ),
    'recent_errors',COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC,x.id DESC)
      FROM (
        SELECT
          e.id,e.gtin,e.status,e.operator_name,e.error_code,e.response_ms,e.created_at,
          p.sku,p.nome
        FROM public.gtin_scan_events e
        LEFT JOIN public.products p ON p.id=e.product_id
        WHERE e.status='system_error'
        ORDER BY e.created_at DESC,e.id DESC
        LIMIT 12
      ) x
    ),'[]'::jsonb)
  )
$$;

REVOKE ALL ON FUNCTION public.nisti_recognition_events_v1(integer,text,boolean,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_operator_stats_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_recognition_metrics_v1(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_system_metrics_core_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_system_health_core_v1() FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_recognition_events_v1(integer,text,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_operator_stats_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_recognition_metrics_v1(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_system_metrics_core_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_system_health_core_v1() TO service_role;
