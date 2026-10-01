-- Supabase-primary administration for Mural NISTI.
-- Keeps D1 compatibility paths available while primary mode bypasses D1 entirely.

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_post_v1(p_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT to_jsonb(x)
  FROM (
    SELECT mp.*,p.sku AS product_sku
    FROM public.mural_posts mp
    LEFT JOIN public.products p ON p.id=mp.product_id
    WHERE mp.id=p_id
    LIMIT 1
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_posts_v1(
  p_status text DEFAULT NULL,
  p_kind text DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY
    CASE x.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END,
    COALESCE(x.published_at,x.created_at) DESC,
    x.id DESC
  ),'[]'::jsonb)
  FROM (
    SELECT
      mp.*,
      p.sku AS product_sku,
      p.nome AS product_name,
      p.miolo_code AS product_miolo_code,
      p.image_key AS product_image_key,
      p.wireo_code,
      p.tassel_code,
      p.elastico_code,
      (
        SELECT mc2.name
        FROM public.mural_collection_products mcp2
        JOIN public.mural_collections mc2 ON mc2.id=mcp2.collection_id
        WHERE mcp2.product_id=p.id AND mc2.status='active'
        ORDER BY COALESCE(mc2.year,0) DESC,mc2.id DESC
        LIMIT 1
      ) AS product_collection_name,
      mc.name AS collection_name,
      mc.slug AS collection_slug,
      mc.image_key AS collection_image_key
    FROM public.mural_posts mp
    LEFT JOIN public.products p ON p.id=mp.product_id
    LEFT JOIN public.mural_collections mc ON mc.id=mp.collection_id
    WHERE (NULLIF(BTRIM(p_status),'') IS NULL OR mp.status=BTRIM(p_status))
      AND (NULLIF(BTRIM(p_kind),'') IS NULL OR mp.kind=BTRIM(p_kind))
    LIMIT 200
  ) x
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_post_write_v1(
  p_action text,
  p_id bigint DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_action text:=lower(BTRIM(COALESCE(p_action,'')));
  v_id bigint:=p_id;
  v_current public.mural_posts%ROWTYPE;
  v_image_key text;
  v_remaining bigint:=0;
  v_published_at timestamptz;
BEGIN
  IF v_action='create' THEN
    IF NULLIF(BTRIM(p_payload->>'kind'),'') IS NULL OR NULLIF(BTRIM(p_payload->>'title'),'') IS NULL THEN
      RETURN jsonb_build_object('status','invalid');
    END IF;
    IF NULLIF(p_payload->>'product_id','') IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=(p_payload->>'product_id')::bigint) THEN
      RETURN jsonb_build_object('status','product_not_found');
    END IF;
    IF NULLIF(p_payload->>'collection_id','') IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.mural_collections WHERE id=(p_payload->>'collection_id')::bigint) THEN
      RETURN jsonb_build_object('status','collection_not_found');
    END IF;

    INSERT INTO public.mural_posts(
      kind,status,title,subtitle,body,badge,badge_tone,product_id,collection_id,notice_level,
      featured,priority,published_at,expires_at,created_by,updated_at
    ) VALUES(
      p_payload->>'kind','draft',p_payload->>'title',NULLIF(p_payload->>'subtitle',''),
      NULLIF(p_payload->>'body',''),NULLIF(p_payload->>'badge',''),NULLIF(p_payload->>'badge_tone',''),
      NULLIF(p_payload->>'product_id','')::bigint,NULLIF(p_payload->>'collection_id','')::bigint,
      NULLIF(p_payload->>'notice_level',''),
      COALESCE(NULLIF(p_payload->>'featured','')::integer,0)<>0,
      COALESCE(NULLIF(p_payload->>'priority','')::integer,0),
      NULLIF(p_payload->>'published_at','')::timestamptz,
      NULLIF(p_payload->>'expires_at','')::timestamptz,
      'admin',now()
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('status','ok','id',v_id,'post_status','draft');
  END IF;

  SELECT * INTO v_current FROM public.mural_posts WHERE id=v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;

  IF v_action='update' THEN
    IF NULLIF(p_payload->>'product_id','') IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=(p_payload->>'product_id')::bigint) THEN
      RETURN jsonb_build_object('status','product_not_found');
    END IF;
    IF NULLIF(p_payload->>'collection_id','') IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM public.mural_collections WHERE id=(p_payload->>'collection_id')::bigint) THEN
      RETURN jsonb_build_object('status','collection_not_found');
    END IF;
    UPDATE public.mural_posts SET
      kind=p_payload->>'kind',
      title=p_payload->>'title',
      subtitle=NULLIF(p_payload->>'subtitle',''),
      body=NULLIF(p_payload->>'body',''),
      badge=NULLIF(p_payload->>'badge',''),
      badge_tone=NULLIF(p_payload->>'badge_tone',''),
      product_id=NULLIF(p_payload->>'product_id','')::bigint,
      collection_id=NULLIF(p_payload->>'collection_id','')::bigint,
      notice_level=NULLIF(p_payload->>'notice_level',''),
      featured=COALESCE(NULLIF(p_payload->>'featured','')::integer,0)<>0,
      priority=COALESCE(NULLIF(p_payload->>'priority','')::integer,0),
      published_at=NULLIF(p_payload->>'published_at','')::timestamptz,
      expires_at=NULLIF(p_payload->>'expires_at','')::timestamptz,
      updated_at=now()
    WHERE id=v_id;
    RETURN jsonb_build_object('status','ok','id',v_id);
  ELSIF v_action='publish' THEN
    v_published_at:=COALESCE(NULLIF(p_payload->>'published_at','')::timestamptz,v_current.published_at,now());
    IF v_current.expires_at IS NOT NULL AND v_current.expires_at<=v_published_at THEN
      RETURN jsonb_build_object('status','invalid_expiration');
    END IF;
    UPDATE public.mural_posts SET status='published',published_at=v_published_at,updated_at=now() WHERE id=v_id;
    RETURN jsonb_build_object('status','ok','id',v_id,'post_status','published','published_at',v_published_at);
  ELSIF v_action='archive' THEN
    UPDATE public.mural_posts SET status='archived',updated_at=now() WHERE id=v_id;
    RETURN jsonb_build_object('status','ok','id',v_id,'post_status','archived');
  ELSIF v_action='duplicate' THEN
    INSERT INTO public.mural_posts(
      kind,status,title,subtitle,body,badge,badge_tone,image_key,product_id,collection_id,notice_level,
      featured,priority,published_at,expires_at,created_by,updated_at
    ) VALUES(
      v_current.kind,'draft',LEFT(v_current.title||' (cópia)',90),v_current.subtitle,v_current.body,
      v_current.badge,v_current.badge_tone,v_current.image_key,v_current.product_id,v_current.collection_id,
      v_current.notice_level,v_current.featured,v_current.priority,NULL,NULL,'admin',now()
    ) RETURNING id INTO v_id;
    RETURN jsonb_build_object('status','ok','id',v_id,'post_status','draft');
  ELSIF v_action='delete' THEN
    v_image_key:=v_current.image_key;
    DELETE FROM public.mural_post_reads WHERE post_id=v_id;
    DELETE FROM public.mural_posts WHERE id=v_id;
    IF v_image_key IS NOT NULL THEN
      SELECT
        (SELECT count(*) FROM public.mural_posts WHERE image_key=v_image_key)
        +(SELECT count(*) FROM public.mural_collections WHERE image_key=v_image_key)
      INTO v_remaining;
    END IF;
    RETURN jsonb_build_object('status','ok','id',v_id,'image_key',v_image_key,'image_references',v_remaining);
  END IF;

  RETURN jsonb_build_object('status','invalid_action');
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_editorial_image_v1(
  p_owner text,
  p_id bigint,
  p_image_key text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_owner text:=lower(BTRIM(COALESCE(p_owner,'')));
  v_old text;
BEGIN
  IF v_owner='posts' THEN
    SELECT image_key INTO v_old FROM public.mural_posts WHERE id=p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
    UPDATE public.mural_posts SET image_key=NULLIF(BTRIM(p_image_key),''),updated_at=now() WHERE id=p_id;
  ELSIF v_owner='collections' THEN
    SELECT image_key INTO v_old FROM public.mural_collections WHERE id=p_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('status','not_found'); END IF;
    UPDATE public.mural_collections SET image_key=NULLIF(BTRIM(p_image_key),''),updated_at=now() WHERE id=p_id;
  ELSE
    RETURN jsonb_build_object('status','invalid_owner');
  END IF;
  RETURN jsonb_build_object('status','ok','old_image_key',v_old,'image_key',NULLIF(BTRIM(p_image_key),''));
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_image_key_v1(p_owner text,p_id bigint)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE v text;
BEGIN
  IF lower(BTRIM(COALESCE(p_owner,'')))='posts' THEN
    SELECT image_key INTO v FROM public.mural_posts WHERE id=p_id;
  ELSIF lower(BTRIM(COALESCE(p_owner,'')))='collections' THEN
    SELECT image_key INTO v FROM public.mural_collections WHERE id=p_id;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_collection_v1(p_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT to_jsonb(mc) FROM public.mural_collections mc WHERE mc.id=p_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_collections_v1()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id',mc.id,'slug',mc.slug,'name',mc.name,'year',mc.year,'description',mc.description,
    'image_key',mc.image_key,'status',mc.status,'created_at',mc.created_at,'updated_at',mc.updated_at,
    'product_count',(SELECT count(*) FROM public.mural_collection_products mcp WHERE mcp.collection_id=mc.id),
    'product_ids',COALESCE((
      SELECT string_agg(mcp.product_id::text,',' ORDER BY mcp.sort_order,mcp.product_id)
      FROM public.mural_collection_products mcp WHERE mcp.collection_id=mc.id
    ),'')
  ) ORDER BY CASE mc.status WHEN 'active' THEN 0 ELSE 1 END,mc.year DESC NULLS LAST,mc.name),'[]'::jsonb)
  FROM public.mural_collections mc
$$;

CREATE OR REPLACE FUNCTION public.nisti_admin_mural_collection_write_v1(
  p_action text,
  p_id bigint DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
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
      INSERT INTO public.mural_collections(slug,name,year,description,status,updated_at)
      VALUES(
        p_payload->>'slug',p_payload->>'name',NULLIF(p_payload->>'year','')::integer,
        NULLIF(p_payload->>'description',''),'active',now()
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
    IF v_current.year IS NOT NULL AND right(v_title,length(v_current.year::text))<>v_current.year::text THEN
      v_title:=v_title||' '||v_current.year::text;
    END IF;
    v_supporting:=COALESCE(NULLIF(BTRIM(v_current.description),''),'Conheça a nova coleção '||v_title||'.');

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
$$;

REVOKE ALL ON FUNCTION public.nisti_admin_mural_post_v1(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_posts_v1(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_post_write_v1(text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_editorial_image_v1(text,bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_image_key_v1(text,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_collection_v1(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_collections_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_admin_mural_collection_write_v1(text,bigint,jsonb) FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_post_v1(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_posts_v1(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_post_write_v1(text,bigint,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_editorial_image_v1(text,bigint,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_image_key_v1(text,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_collection_v1(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_collections_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_admin_mural_collection_write_v1(text,bigint,jsonb) TO service_role;
