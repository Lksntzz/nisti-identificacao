-- Per-device diagnostic acknowledgement. This never creates a publication or sends push.
CREATE TABLE IF NOT EXISTS public.operator_push_test_receipts (
  test_id uuid PRIMARY KEY,
  user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  display_status text NOT NULL DEFAULT 'pending'
    CHECK (display_status IN ('pending','shown','failed')),
  acknowledged_at timestamptz
);
CREATE INDEX IF NOT EXISTS operator_push_test_receipts_created_at_idx
  ON public.operator_push_test_receipts (created_at);

CREATE OR REPLACE FUNCTION public.nisti_open_operator_push_test_v1(p_test_id uuid,p_user_id text)
RETURNS boolean LANGUAGE plpgsql SET search_path='public' AS $$
BEGIN
  IF p_user_id !~ '^op_[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
  INSERT INTO public.operator_push_test_receipts (test_id,user_id)
  VALUES(p_test_id,p_user_id) ON CONFLICT DO NOTHING;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.nisti_ack_operator_push_test_v1(
  p_test_id uuid,p_user_id text,p_status text)
RETURNS boolean LANGUAGE plpgsql SET search_path='public' AS $$
BEGIN
  IF p_status NOT IN ('shown','failed') THEN RETURN false; END IF;
  UPDATE public.operator_push_test_receipts
  SET display_status=p_status,acknowledged_at=now()
  WHERE test_id=p_test_id AND user_id=p_user_id
    AND created_at>now()-interval '10 minutes' AND display_status='pending';
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.nisti_get_operator_push_test_v1(
  p_test_id uuid,p_user_id text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='public' AS $$
  SELECT jsonb_build_object('display_status',display_status,'acknowledged',acknowledged_at IS NOT NULL)
  FROM public.operator_push_test_receipts
  WHERE test_id=p_test_id AND user_id=p_user_id
    AND created_at>now()-interval '10 minutes';
$$;

REVOKE ALL ON TABLE public.operator_push_test_receipts FROM public,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.operator_push_test_receipts TO service_role;
REVOKE EXECUTE ON FUNCTION public.nisti_open_operator_push_test_v1(uuid,text) FROM public,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.nisti_ack_operator_push_test_v1(uuid,text,text) FROM public,anon,authenticated;
REVOKE EXECUTE ON FUNCTION public.nisti_get_operator_push_test_v1(uuid,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_open_operator_push_test_v1(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_ack_operator_push_test_v1(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_get_operator_push_test_v1(uuid,text) TO service_role;
