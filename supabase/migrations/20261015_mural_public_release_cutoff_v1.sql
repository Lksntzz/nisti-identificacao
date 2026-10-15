-- Mark the actual start of public Mural availability before deploying the public-release Worker.
-- Pre-release drafts/QA announcements must not trigger a backlog push storm on release.
CREATE TABLE IF NOT EXISTS public.mural_push_release_gate (
  id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
  released_at timestamptz NOT NULL
);
INSERT INTO public.mural_push_release_gate(id,released_at)
VALUES(true,now()) ON CONFLICT(id) DO NOTHING;
REVOKE ALL ON TABLE public.mural_push_release_gate FROM public,anon,authenticated;
GRANT SELECT ON TABLE public.mural_push_release_gate TO service_role;

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
      AND p.published_at>=GREATEST(
        now()-interval '2 hours',
        (SELECT released_at FROM public.mural_push_release_gate WHERE id=true)
      )
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


REVOKE EXECUTE ON FUNCTION public.nisti_list_mural_push_ready_v1(integer) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_list_mural_push_ready_v1(integer) TO service_role;
