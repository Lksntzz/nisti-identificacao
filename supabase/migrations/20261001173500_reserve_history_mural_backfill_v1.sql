-- NISTI reserve backfill and read fallback for GTIN history + Mural.
-- D1 remains primary. Supabase is used only after the corresponding initial
-- backfill stream is marked complete.

CREATE TABLE IF NOT EXISTS public.gtin_scan_events (
  id bigint PRIMARY KEY,
  gtin text NOT NULL,
  status text NOT NULL CHECK (status IN ('identified','not_found','system_error')),
  product_id bigint REFERENCES public.products(id) ON DELETE SET NULL,
  operator_name text,
  operator_id text,
  response_ms integer NOT NULL DEFAULT 0,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  dismissed_by text
);

CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_created_at
  ON public.gtin_scan_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_status_created_at
  ON public.gtin_scan_events(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_pending
  ON public.gtin_scan_events(status, dismissed_at, id DESC);

ALTER TABLE public.gtin_scan_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.gtin_scan_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.gtin_scan_events TO service_role;

CREATE TABLE IF NOT EXISTS public.nisti_reserve_sync_state (
  stream text PRIMARY KEY,
  last_numeric bigint NOT NULL DEFAULT 0,
  last_text text,
  complete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nisti_reserve_sync_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nisti_reserve_sync_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.nisti_reserve_sync_state TO service_role;

INSERT INTO public.nisti_reserve_sync_state(stream)
VALUES
  ('gtin_scan_events'),
  ('mural_collections'),
  ('mural_posts'),
  ('mural_collection_products'),
  ('mural_post_reads')
ON CONFLICT (stream) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nisti_reserve_stream_state_v1(p_stream text)
RETURNS TABLE (
  stream text,
  last_numeric bigint,
  last_text text,
  complete boolean,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT s.stream,s.last_numeric,s.last_text,s.complete,s.updated_at
  FROM public.nisti_reserve_sync_state s
  WHERE s.stream=btrim(p_stream)
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_stream_state_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_stream_state_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_stream_checkpoint_v1(
  p_stream text,
  p_last_numeric bigint,
  p_last_text text,
  p_complete boolean
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.nisti_reserve_sync_state(stream,last_numeric,last_text,complete,updated_at)
  VALUES (
    btrim(p_stream),
    GREATEST(0,COALESCE(p_last_numeric,0)),
    NULLIF(p_last_text,''),
    COALESCE(p_complete,false),
    now()
  )
  ON CONFLICT (stream) DO UPDATE SET
    last_numeric=EXCLUDED.last_numeric,
    last_text=EXCLUDED.last_text,
    complete=EXCLUDED.complete,
    updated_at=now();
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_stream_checkpoint_v1(text,bigint,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_stream_checkpoint_v1(text,bigint,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_stream_ready_v1(p_stream text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT s.complete
    FROM public.nisti_reserve_sync_state s
    WHERE s.stream=btrim(p_stream)
    LIMIT 1
  ),false);
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_stream_ready_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_stream_ready_v1(text) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mirror_gtin_scan_events_batch_v1(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF jsonb_typeof(COALESCE(p_rows,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be an array';
  END IF;

  INSERT INTO public.gtin_scan_events (
    id,gtin,status,product_id,operator_name,operator_id,response_ms,error_code,
    created_at,dismissed_at,dismissed_by
  )
  SELECT
    x.id,x.gtin,x.status,x.product_id,x.operator_name,x.operator_id,
    COALESCE(x.response_ms,0),x.error_code,
    COALESCE(x.created_at,now()),x.dismissed_at,x.dismissed_by
  FROM jsonb_to_recordset(COALESCE(p_rows,'[]'::jsonb)) AS x(
    id bigint,
    gtin text,
    status text,
    product_id bigint,
    operator_name text,
    operator_id text,
    response_ms integer,
    error_code text,
    created_at timestamptz,
    dismissed_at timestamptz,
    dismissed_by text
  )
  WHERE x.id IS NOT NULL AND x.id > 0
  ON CONFLICT (id) DO UPDATE SET
    gtin=EXCLUDED.gtin,
    status=EXCLUDED.status,
    product_id=EXCLUDED.product_id,
    operator_name=EXCLUDED.operator_name,
    operator_id=EXCLUDED.operator_id,
    response_ms=EXCLUDED.response_ms,
    error_code=EXCLUDED.error_code,
    created_at=EXCLUDED.created_at,
    dismissed_at=EXCLUDED.dismissed_at,
    dismissed_by=EXCLUDED.dismissed_by;
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_mirror_gtin_scan_events_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_gtin_scan_events_batch_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_update_gtin_scan_event_dismissal_v1(
  p_id bigint,
  p_dismissed_at timestamptz,
  p_dismissed_by text
)
RETURNS void
LANGUAGE sql
SET search_path TO 'public'
AS $function$
  UPDATE public.gtin_scan_events
  SET dismissed_at=p_dismissed_at,
      dismissed_by=p_dismissed_by
  WHERE id=p_id;
$function$;

REVOKE ALL ON FUNCTION public.nisti_update_gtin_scan_event_dismissal_v1(bigint,timestamptz,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_update_gtin_scan_event_dismissal_v1(bigint,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_gtin_events_v1(
  p_status text DEFAULT NULL,
  p_pending boolean DEFAULT false,
  p_today boolean DEFAULT false,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  id bigint,
  gtin text,
  status text,
  product_id bigint,
  operator_name text,
  operator_id text,
  response_ms integer,
  error_code text,
  created_at timestamptz,
  dismissed_at timestamptz,
  dismissed_by text,
  sku text,
  nome text,
  variacao text,
  capa_code text,
  image_key text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.nisti_reserve_stream_ready_v1('gtin_scan_events') THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:gtin_scan_events';
  END IF;

  RETURN QUERY
  SELECT
    e.id,e.gtin,e.status,e.product_id,e.operator_name,e.operator_id,
    e.response_ms,e.error_code,e.created_at,e.dismissed_at,e.dismissed_by,
    p.sku,p.nome,p.variacao,p.capa_code,p.image_key,
    COUNT(*) OVER()::bigint AS total_count
  FROM public.gtin_scan_events e
  LEFT JOIN public.products p ON p.id=e.product_id
  WHERE
    (NULLIF(btrim(COALESCE(p_status,'')),'') IS NULL OR e.status=btrim(p_status))
    AND (NOT COALESCE(p_pending,false) OR e.dismissed_at IS NULL)
    AND (
      NOT COALESCE(p_today,false)
      OR (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date
         = (now() AT TIME ZONE 'America/Sao_Paulo')::date
    )
    AND (
      NULLIF(btrim(COALESCE(p_query,'')),'') IS NULL
      OR e.gtin ILIKE '%'||btrim(p_query)||'%'
      OR COALESCE(e.operator_name,'') ILIKE '%'||btrim(p_query)||'%'
      OR COALESCE(p.sku,'') ILIKE '%'||btrim(p_query)||'%'
      OR COALESCE(p.nome,'') ILIKE '%'||btrim(p_query)||'%'
    )
  ORDER BY e.id DESC
  LIMIT GREATEST(1,LEAST(100,COALESCE(p_limit,25)))
  OFFSET GREATEST(0,COALESCE(p_offset,0));
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_gtin_events_v1(text,boolean,boolean,text,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_gtin_events_v1(text,boolean,boolean,text,integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mirror_mural_collections_batch_v1(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.mural_collections (
    id,slug,name,year,description,image_key,status,created_at,updated_at
  )
  SELECT
    x.id,x.slug,x.name,x.year,x.description,x.image_key,
    COALESCE(NULLIF(x.status,''),'active'),
    COALESCE(x.created_at,now()),
    COALESCE(x.updated_at,now())
  FROM jsonb_to_recordset(COALESCE(p_rows,'[]'::jsonb)) AS x(
    id bigint,slug text,name text,year integer,description text,image_key text,status text,
    created_at timestamptz,updated_at timestamptz
  )
  WHERE x.id IS NOT NULL AND x.id > 0
  ON CONFLICT (id) DO UPDATE SET
    slug=EXCLUDED.slug,
    name=EXCLUDED.name,
    year=EXCLUDED.year,
    description=EXCLUDED.description,
    image_key=EXCLUDED.image_key,
    status=EXCLUDED.status,
    updated_at=EXCLUDED.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_mirror_mural_collections_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_mural_collections_batch_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mirror_mural_posts_batch_v1(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.mural_posts (
    id,kind,status,title,subtitle,body,badge,badge_tone,image_key,product_id,
    collection_id,notice_level,featured,priority,published_at,expires_at,created_by,
    created_at,updated_at
  )
  SELECT
    x.id,x.kind,x.status,x.title,x.subtitle,x.body,x.badge,x.badge_tone,x.image_key,
    x.product_id,x.collection_id,x.notice_level,COALESCE(x.featured,false),
    COALESCE(x.priority,0),x.published_at,x.expires_at,x.created_by,
    COALESCE(x.created_at,now()),COALESCE(x.updated_at,now())
  FROM jsonb_to_recordset(COALESCE(p_rows,'[]'::jsonb)) AS x(
    id bigint,kind text,status text,title text,subtitle text,body text,badge text,badge_tone text,
    image_key text,product_id bigint,collection_id bigint,notice_level text,featured boolean,
    priority integer,published_at timestamptz,expires_at timestamptz,created_by text,
    created_at timestamptz,updated_at timestamptz
  )
  WHERE x.id IS NOT NULL AND x.id > 0
  ON CONFLICT (id) DO UPDATE SET
    kind=EXCLUDED.kind,
    status=EXCLUDED.status,
    title=EXCLUDED.title,
    subtitle=EXCLUDED.subtitle,
    body=EXCLUDED.body,
    badge=EXCLUDED.badge,
    badge_tone=EXCLUDED.badge_tone,
    image_key=EXCLUDED.image_key,
    product_id=EXCLUDED.product_id,
    collection_id=EXCLUDED.collection_id,
    notice_level=EXCLUDED.notice_level,
    featured=EXCLUDED.featured,
    priority=EXCLUDED.priority,
    published_at=EXCLUDED.published_at,
    expires_at=EXCLUDED.expires_at,
    created_by=EXCLUDED.created_by,
    updated_at=EXCLUDED.updated_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_mirror_mural_posts_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_mural_posts_batch_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mirror_mural_collection_products_batch_v1(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.mural_collection_products(collection_id,product_id,sort_order)
  SELECT x.collection_id,x.product_id,COALESCE(x.sort_order,0)
  FROM jsonb_to_recordset(COALESCE(p_rows,'[]'::jsonb)) AS x(
    collection_id bigint,product_id bigint,sort_order integer
  )
  WHERE x.collection_id IS NOT NULL AND x.product_id IS NOT NULL
  ON CONFLICT (collection_id,product_id) DO UPDATE SET
    sort_order=EXCLUDED.sort_order;
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_mirror_mural_collection_products_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_mural_collection_products_batch_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_mirror_mural_post_reads_batch_v1(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.mural_post_reads(post_id,user_id,read_at)
  SELECT x.post_id,x.user_id,COALESCE(x.read_at,now())
  FROM jsonb_to_recordset(COALESCE(p_rows,'[]'::jsonb)) AS x(
    post_id bigint,user_id text,read_at timestamptz
  )
  WHERE x.post_id IS NOT NULL AND NULLIF(btrim(x.user_id),'') IS NOT NULL
  ON CONFLICT (post_id,user_id) DO UPDATE SET
    read_at=EXCLUDED.read_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_mirror_mural_post_reads_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_mirror_mural_post_reads_batch_v1(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_ready_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT bool_and(COALESCE(s.complete,false))
  FROM public.nisti_reserve_sync_state s
  WHERE s.stream IN (
    'mural_collections',
    'mural_posts',
    'mural_collection_products',
    'mural_post_reads'
  );
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_mural_ready_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_mural_ready_v1() TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_feed_v1(
  p_user_id text,
  p_kind text DEFAULT NULL,
  p_limit integer DEFAULT 20,
  p_cursor_featured boolean DEFAULT NULL,
  p_cursor_priority integer DEFAULT NULL,
  p_cursor_published_at timestamptz DEFAULT NULL,
  p_cursor_id bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1,LEAST(50,COALESCE(p_limit,20)));
  v_rows jsonb;
  v_preview jsonb;
  v_unread bigint;
BEGIN
  IF NOT public.nisti_reserve_mural_ready_v1() THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:mural';
  END IF;

  WITH feed AS (
    SELECT
      mp.id,mp.kind,mp.title,mp.subtitle,mp.body,mp.badge,mp.badge_tone,
      mp.featured,mp.priority,mp.published_at,mp.expires_at,mp.image_key,
      mp.notice_level,
      p.id AS product_id,p.sku,p.miolo_code,p.nome AS product_name,
      p.wireo_code,p.tassel_code,p.elastico_code,p.image_key AS product_image_key,
      mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key,
      (
        SELECT mc2.name
        FROM public.mural_collection_products mcp2
        INNER JOIN public.mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS product_collection_name,
      mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,
      mc.year AS collection_year,mc.description AS collection_description,
      mc.image_key AS collection_image_key,
      (mr.post_id IS NOT NULL) AS is_read
    FROM public.mural_posts mp
    LEFT JOIN public.products p ON p.id=mp.product_id
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    LEFT JOIN public.mural_collections mc ON mc.id=mp.collection_id
    LEFT JOIN public.mural_post_reads mr
      ON mr.post_id=mp.id
     AND mr.user_id=LEFT(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100)
    WHERE mp.status='published'
      AND mp.published_at IS NOT NULL
      AND mp.published_at <= now()
      AND (mp.expires_at IS NULL OR mp.expires_at > now())
      AND (NULLIF(btrim(COALESCE(p_kind,'')),'') IS NULL OR mp.kind=btrim(p_kind))
      AND (
        p_cursor_id IS NULL
        OR mp.featured < COALESCE(p_cursor_featured,false)
        OR (mp.featured = COALESCE(p_cursor_featured,false) AND mp.priority < COALESCE(p_cursor_priority,0))
        OR (
          mp.featured = COALESCE(p_cursor_featured,false)
          AND mp.priority = COALESCE(p_cursor_priority,0)
          AND mp.published_at < p_cursor_published_at
        )
        OR (
          mp.featured = COALESCE(p_cursor_featured,false)
          AND mp.priority = COALESCE(p_cursor_priority,0)
          AND mp.published_at = p_cursor_published_at
          AND mp.id < p_cursor_id
        )
      )
    ORDER BY mp.featured DESC,mp.priority DESC,mp.published_at DESC,mp.id DESC
    LIMIT v_limit + 1
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(feed)),'[]'::jsonb)
  INTO v_rows
  FROM feed;

  WITH ids AS (
    SELECT DISTINCT (x->>'collection_id')::bigint AS collection_id
    FROM jsonb_array_elements(v_rows) x
    WHERE x->>'kind'='collection' AND NULLIF(x->>'collection_id','') IS NOT NULL
  ),
  previews AS (
    SELECT
      mcp.collection_id,mcp.sort_order,
      p.id,p.sku,p.nome,p.variacao,p.miolo_code,p.image_key,
      mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key
    FROM public.mural_collection_products mcp
    INNER JOIN ids ON ids.collection_id=mcp.collection_id
    INNER JOIN public.products p ON p.id=mcp.product_id
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    ORDER BY mcp.collection_id ASC,mcp.sort_order ASC,p.sku ASC,p.id ASC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(previews)),'[]'::jsonb)
  INTO v_preview
  FROM previews;

  SELECT COUNT(*)::bigint
  INTO v_unread
  FROM public.mural_posts mp
  LEFT JOIN public.mural_post_reads mr
    ON mr.post_id=mp.id
   AND mr.user_id=LEFT(COALESCE(NULLIF(btrim(p_user_id),''),'anonymous'),100)
  WHERE mp.status='published'
    AND mp.published_at IS NOT NULL
    AND mp.published_at <= now()
    AND (mp.expires_at IS NULL OR mp.expires_at > now())
    AND mr.post_id IS NULL;

  RETURN jsonb_build_object(
    'rows',v_rows,
    'preview_rows',v_preview,
    'unread_count',COALESCE(v_unread,0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_mural_feed_v1(text,text,integer,boolean,integer,timestamptz,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_mural_feed_v1(text,text,integer,boolean,integer,timestamptz,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_collection_v1(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_collection jsonb;
  v_products jsonb;
  v_id bigint;
BEGIN
  IF NOT public.nisti_reserve_mural_ready_v1() THEN
    RAISE EXCEPTION 'reserve_stream_not_ready:mural';
  END IF;

  SELECT c.id,to_jsonb(c)
  INTO v_id,v_collection
  FROM (
    SELECT id,slug,name,year,description,image_key,status
    FROM public.mural_collections
    WHERE slug=p_slug AND status='active'
    LIMIT 1
  ) c;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.sort_order,x.sku,x.id),'[]'::jsonb)
  INTO v_products
  FROM (
    SELECT
      p.id,p.sku,p.miolo_code,p.nome,p.variacao,p.wireo_code,p.tassel_code,p.elastico_code,p.image_key,
      mpi.status AS mural_image_status,mpi.reviewed_by AS mural_image_reviewed_by,
      mpi.source_image_key AS mural_source_image_key,
      mpi.processed_image_key AS mural_processed_image_key,
      mcp.sort_order
    FROM public.mural_collection_products mcp
    INNER JOIN public.products p ON p.id=mcp.product_id
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE mcp.collection_id=v_id
  ) x;

  RETURN jsonb_build_object('collection',v_collection,'products',v_products);
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_reserve_mural_collection_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reserve_mural_collection_v1(text) TO service_role;
