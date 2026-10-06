ALTER TABLE public.mural_collections
  ADD COLUMN IF NOT EXISTS show_year boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS hero_message text,
  ADD COLUMN IF NOT EXISTS visual_direction text NOT NULL DEFAULT 'automatic',
  ADD COLUMN IF NOT EXISTS theme_notes text;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_collections_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',mc.id,'slug',mc.slug,'name',mc.name,'year',mc.year,'show_year',mc.show_year,
    'hero_message',mc.hero_message,'visual_direction',mc.visual_direction,'theme_notes',mc.theme_notes,
    'description',mc.description,'image_key',mc.image_key,'status',mc.status,
    'created_at',mc.created_at,'updated_at',mc.updated_at,
    'product_count',(SELECT count(*) FROM public.mural_collection_products mcp WHERE mcp.collection_id=mc.id),
    'product_ids',COALESCE((
      SELECT string_agg(mcp.product_id::text,',' ORDER BY mcp.sort_order,mcp.product_id)
      FROM public.mural_collection_products mcp WHERE mcp.collection_id=mc.id
    ),'')
  ) ORDER BY CASE mc.status WHEN 'active' THEN 0 ELSE 1 END,mc.year DESC NULLS LAST,mc.name),'[]'::jsonb)
  FROM public.mural_collections mc
$function$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_collection_write_v1(
  p_action text,
  p_id bigint DEFAULT NULL::bigint,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_action text:=lower(BTRIM(COALESCE(p_action,'')));
  v_current public.mural_collections%ROWTYPE;
  v_id bigint:=p_id;
  v_ids jsonb:=COALESCE(p_payload->'product_ids','[]'::jsonb);
  v_expected integer:=0;
  v_found integer:=0;
  v_existing_id bigint:=0;
  v_post_id bigint:=0;
  v_title text;
  v_supporting text;
  v_published_at timestamptz:=now();
  v_count integer:=0;
BEGIN
  IF v_action='create' THEN
    BEGIN
      INSERT INTO public.mural_collections(
        slug,name,year,show_year,hero_message,visual_direction,theme_notes,description,status,updated_at
      )
      VALUES(
        p_payload->>'slug',
        p_payload->>'name',
        NULLIF(p_payload->>'year','')::integer,
        COALESCE(NULLIF(p_payload->>'show_year','')::boolean,true),
        NULLIF(p_payload->>'hero_message',''),
        COALESCE(NULLIF(p_payload->>'visual_direction',''),'automatic'),
        NULLIF(p_payload->>'theme_notes',''),
        NULLIF(p_payload->>'description',''),
        'active',
        now()
      ) RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('status','slug_conflict');
    END;
    RETURN jsonb_build_object('status','ok','id',v_id,'slug',p_payload->>'slug');
  END IF;

  SELECT * INTO v_current FROM public.mural_collections WHERE id=v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;

  IF v_action='update' THEN
    BEGIN
      UPDATE public.mural_collections SET
        slug=p_payload->>'slug',
        name=p_payload->>'name',
        year=NULLIF(p_payload->>'year','')::integer,
        show_year=COALESCE(NULLIF(p_payload->>'show_year','')::boolean,true),
        hero_message=NULLIF(p_payload->>'hero_message',''),
        visual_direction=COALESCE(NULLIF(p_payload->>'visual_direction',''),'automatic'),
        theme_notes=NULLIF(p_payload->>'theme_notes',''),
        description=NULLIF(p_payload->>'description',''),
        status=p_payload->>'status',
        updated_at=now()
      WHERE id=v_id;
    EXCEPTION WHEN unique_violation THEN
      RETURN jsonb_build_object('status','slug_conflict');
    END;
    RETURN jsonb_build_object('status','ok','id',v_id,'slug',p_payload->>'slug');

  ELSIF v_action='set_products' THEN
    IF jsonb_typeof(v_ids)<>'array' THEN RETURN jsonb_build_object('status','invalid_products'); END IF;
    SELECT count(DISTINCT value::bigint) INTO v_expected FROM jsonb_array_elements_text(v_ids);
    SELECT count(*) INTO v_found FROM public.products
      WHERE id IN (SELECT DISTINCT value::bigint FROM jsonb_array_elements_text(v_ids));
    IF v_found<>v_expected THEN RETURN jsonb_build_object('status','product_not_found'); END IF;

    DELETE FROM public.mural_collection_products WHERE collection_id=v_id;
    INSERT INTO public.mural_collection_products(collection_id,product_id,sort_order)
    SELECT v_id,value::bigint,(ord-1)::integer
    FROM jsonb_array_elements_text(v_ids) WITH ORDINALITY AS t(value,ord)
    ON CONFLICT(collection_id,product_id) DO UPDATE SET sort_order=EXCLUDED.sort_order;
    RETURN jsonb_build_object('status','ok','count',v_expected);

  ELSIF v_action='publish' THEN
    IF v_current.status<>'active' THEN RETURN jsonb_build_object('status','inactive'); END IF;
    SELECT count(*) INTO v_count FROM public.mural_collection_products WHERE collection_id=v_id;
    IF v_count<1 THEN RETURN jsonb_build_object('status','empty'); END IF;

    v_title:=BTRIM(v_current.name);
    IF COALESCE(v_current.show_year,true)
       AND v_current.year IS NOT NULL
       AND right(v_title,length(v_current.year::text))<>v_current.year::text THEN
      v_title:=v_title||' '||v_current.year::text;
    END IF;

    v_supporting:=COALESCE(
      NULLIF(BTRIM(v_current.hero_message),''),
      NULLIF(BTRIM(v_current.description),''),
      'Conheça a nova coleção '||v_title||'.'
    );

    SELECT id INTO v_existing_id FROM public.mural_posts
      WHERE kind='collection' AND collection_id=v_id ORDER BY id DESC LIMIT 1;
    v_existing_id:=COALESCE(v_existing_id,0);

    UPDATE public.mural_posts SET featured=false,updated_at=now()
    WHERE featured=true AND status='published' AND id<>v_existing_id;

    IF v_existing_id>0 THEN
      UPDATE public.mural_posts SET status='archived',featured=false,updated_at=now()
      WHERE kind='collection' AND collection_id=v_id AND id<>v_existing_id;
      UPDATE public.mural_posts SET
        status='published',title=v_title,subtitle=v_supporting,body=NULL,badge='NOVA COLEÇÃO',
        badge_tone='launch',product_id=NULL,collection_id=v_id,notice_level=NULL,featured=true,
        priority=100,published_at=v_published_at,expires_at=NULL,updated_at=now()
      WHERE id=v_existing_id;
      v_post_id:=v_existing_id;
    ELSE
      INSERT INTO public.mural_posts(
        kind,status,title,subtitle,body,badge,badge_tone,image_key,product_id,collection_id,
        notice_level,featured,priority,published_at,expires_at,created_by,updated_at
      ) VALUES(
        'collection','published',v_title,v_supporting,NULL,'NOVA COLEÇÃO','launch',NULL,NULL,v_id,
        NULL,true,100,v_published_at,NULL,'admin',now()
      ) RETURNING id INTO v_post_id;
    END IF;

    RETURN jsonb_build_object(
      'status','ok','id',v_post_id,'collection_id',v_id,'post_status','published',
      'featured',true,'badge','NOVA COLEÇÃO','published_at',v_published_at,'product_count',v_count
    );
  END IF;

  RETURN jsonb_build_object('status','invalid_action');
END;
$function$;

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
    SELECT id,slug,name,year,show_year,hero_message,visual_direction,theme_notes,description,image_key,status
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
      mpi.processor_version AS mural_image_processor_version,
      mcp.sort_order
    FROM public.mural_collection_products mcp
    INNER JOIN public.products p ON p.id=mcp.product_id
    LEFT JOIN public.mural_product_images mpi ON mpi.product_id=p.id
    WHERE mcp.collection_id=v_id
  ) x;

  RETURN jsonb_build_object('collection',v_collection,'products',v_products);
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_reserve_mural_feed_v1(
  p_user_id text,
  p_kind text DEFAULT NULL::text,
  p_limit integer DEFAULT 20,
  p_cursor_featured boolean DEFAULT NULL::boolean,
  p_cursor_priority integer DEFAULT NULL::integer,
  p_cursor_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id bigint DEFAULT NULL::bigint
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
      mpi.processor_version AS mural_image_processor_version,
      (
        SELECT mc2.name
        FROM public.mural_collection_products mcp2
        INNER JOIN public.mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS product_collection_name,
      mc.id AS collection_id,mc.slug AS collection_slug,mc.name AS collection_name,
      mc.year AS collection_year,mc.show_year AS collection_show_year,
      mc.hero_message AS collection_hero_message,
      mc.visual_direction AS collection_visual_direction,
      mc.theme_notes AS collection_theme_notes,
      mc.description AS collection_description,mc.image_key AS collection_image_key,
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
      mpi.processed_image_key AS mural_processed_image_key,
      mpi.processor_version AS mural_image_processor_version
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
