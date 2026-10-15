-- Automatic Mural notifications: recent/scheduled posts and bounded retries.
-- Release gate is enforced by the Worker before this function is ever called.
ALTER TABLE public.mural_push_deliveries
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1;
ALTER TABLE public.mural_push_deliveries
  ADD CONSTRAINT mural_push_deliveries_attempts_positive CHECK (attempts BETWEEN 1 AND 3);

CREATE OR REPLACE FUNCTION public.nisti_list_mural_push_ready_v1(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='public' AS $$
  SELECT COALESCE(jsonb_agg(ready.id ORDER BY ready.published_at,ready.id),'[]'::jsonb)
  FROM (
    SELECT p.id,p.published_at
    FROM public.mural_posts p
    WHERE p.status='published'
      AND p.kind IN ('collection','product','notice')
      AND p.published_at IS NOT NULL
      AND p.published_at<=now()
      -- Do not send a backlog of old admin/QA publications after release.
      AND p.published_at>=now()-interval '2 hours'
      AND (p.expires_at IS NULL OR p.expires_at>now())
      AND EXISTS (
        SELECT 1 FROM public.push_subscriptions s
        WHERE s.user_id ~ '^op_[0-9a-fA-F-]{36}$'
          AND s.endpoint IS NOT NULL AND s.p256dh IS NOT NULL AND s.auth IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.mural_push_deliveries d
            WHERE d.post_id=p.id AND d.operator_user_id=s.user_id
              AND (d.state IN ('claimed','sent') OR d.attempts>=3
                OR d.claimed_at>now()-interval '10 minutes')
          )
      )
    ORDER BY p.published_at,p.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit,20),1),50)
  ) ready;
$$;

CREATE OR REPLACE FUNCTION public.nisti_claim_mural_push_targets_v1(p_post_id bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path='public' AS $$
DECLARE v_post record; v_targets jsonb;
BEGIN
  SELECT id,kind,title,subtitle,body,notice_level INTO v_post
  FROM public.mural_posts
  WHERE id=p_post_id AND status='published'
    AND kind IN ('collection','notice','product')
    AND published_at IS NOT NULL AND published_at<=now()
    AND (expires_at IS NULL OR expires_at>now());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible',false,'targets','[]'::jsonb);
  END IF;
  WITH devices AS (
    SELECT DISTINCT ON (user_id) id,user_id,endpoint,p256dh,auth
    FROM public.push_subscriptions
    WHERE user_id ~ '^op_[0-9a-fA-F-]{36}$'
      AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL
    ORDER BY user_id,updated_at DESC,id DESC
  ), claimed AS (
    INSERT INTO public.mural_push_deliveries
      (post_id,operator_user_id,subscription_id,state,claimed_at,completed_at,attempts)
    SELECT p_post_id,d.user_id,d.id,'claimed',now(),NULL,1 FROM devices d
    ON CONFLICT (post_id,operator_user_id) DO UPDATE SET
      subscription_id=EXCLUDED.subscription_id,
      state='claimed',
      claimed_at=now(),
      completed_at=NULL,
      attempts=public.mural_push_deliveries.attempts+1
    WHERE public.mural_push_deliveries.state='failed'
      AND public.mural_push_deliveries.attempts<3
      AND public.mural_push_deliveries.claimed_at<now()-interval '10 minutes'
    RETURNING operator_user_id,subscription_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'operator_user_id',claimed.operator_user_id,'id',d.id,
    'endpoint',d.endpoint,'p256dh',d.p256dh,'auth',d.auth)),'[]'::jsonb)
  INTO v_targets
  FROM claimed JOIN public.push_subscriptions d ON d.id=claimed.subscription_id;
  RETURN jsonb_build_object('eligible',true,'kind',v_post.kind,
    'title',v_post.title,'subtitle',v_post.subtitle,'body',v_post.body,
    'notice_level',v_post.notice_level,'targets',COALESCE(v_targets,'[]'::jsonb));
END $$;
REVOKE EXECUTE ON FUNCTION public.nisti_list_mural_push_ready_v1(integer) FROM public,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.nisti_claim_mural_push_targets_v1(bigint) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_list_mural_push_ready_v1(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_claim_mural_push_targets_v1(bigint) TO service_role;
