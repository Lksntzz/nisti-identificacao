-- Canva image bridge v1.
-- Stores only encrypted OAuth material. Client ID/secret and encryption key stay
-- in Cloudflare Worker secrets and are never stored in PostgreSQL.

CREATE TABLE IF NOT EXISTS public.nisti_canva_connection (
  id text PRIMARY KEY CHECK (id = 'primary'),
  payload_ciphertext text NOT NULL,
  payload_iv text NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.nisti_canva_oauth_states (
  state_hash text PRIMARY KEY,
  payload_ciphertext text NOT NULL,
  payload_iv text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.nisti_canva_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nisti_canva_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.nisti_canva_connection FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.nisti_canva_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nisti_canva_connection TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nisti_canva_oauth_states TO service_role;

CREATE OR REPLACE FUNCTION public.nisti_canva_connection_get_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN c.id IS NULL THEN NULL
    ELSE jsonb_build_object(
      'payload_ciphertext', c.payload_ciphertext,
      'payload_iv', c.payload_iv,
      'connected_at', c.connected_at,
      'updated_at', c.updated_at
    )
  END
  FROM (SELECT 1) seed
  LEFT JOIN public.nisti_canva_connection c ON c.id='primary'
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_canva_connection_set_v1(
  p_payload_ciphertext text,
  p_payload_iv text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NULLIF(btrim(p_payload_ciphertext),'') IS NULL
     OR NULLIF(btrim(p_payload_iv),'') IS NULL THEN
    RAISE EXCEPTION 'invalid_canva_connection_payload';
  END IF;

  INSERT INTO public.nisti_canva_connection(
    id,payload_ciphertext,payload_iv,connected_at,updated_at
  )
  VALUES('primary',p_payload_ciphertext,p_payload_iv,now(),now())
  ON CONFLICT(id) DO UPDATE SET
    payload_ciphertext=EXCLUDED.payload_ciphertext,
    payload_iv=EXCLUDED.payload_iv,
    updated_at=now();

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_canva_connection_clear_v1()
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM public.nisti_canva_connection WHERE id='primary';
  DELETE FROM public.nisti_canva_oauth_states;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_canva_oauth_state_put_v1(
  p_state_hash text,
  p_payload_ciphertext text,
  p_payload_iv text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  DELETE FROM public.nisti_canva_oauth_states WHERE expires_at <= now();

  IF NULLIF(btrim(p_state_hash),'') IS NULL
     OR NULLIF(btrim(p_payload_ciphertext),'') IS NULL
     OR NULLIF(btrim(p_payload_iv),'') IS NULL
     OR p_expires_at IS NULL
     OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'invalid_canva_oauth_state';
  END IF;

  INSERT INTO public.nisti_canva_oauth_states(
    state_hash,payload_ciphertext,payload_iv,expires_at,created_at
  )
  VALUES(
    p_state_hash,p_payload_ciphertext,p_payload_iv,p_expires_at,now()
  )
  ON CONFLICT(state_hash) DO UPDATE SET
    payload_ciphertext=EXCLUDED.payload_ciphertext,
    payload_iv=EXCLUDED.payload_iv,
    expires_at=EXCLUDED.expires_at,
    created_at=now();

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.nisti_canva_oauth_state_take_v1(
  p_state_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.nisti_canva_oauth_states%ROWTYPE;
BEGIN
  DELETE FROM public.nisti_canva_oauth_states WHERE expires_at <= now();

  DELETE FROM public.nisti_canva_oauth_states
  WHERE state_hash=p_state_hash
    AND expires_at > now()
  RETURNING * INTO v_row;

  IF v_row.state_hash IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'payload_ciphertext',v_row.payload_ciphertext,
    'payload_iv',v_row.payload_iv
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.nisti_canva_connection_get_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_canva_connection_set_v1(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_canva_connection_clear_v1() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_canva_oauth_state_put_v1(text,text,text,timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nisti_canva_oauth_state_take_v1(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.nisti_canva_connection_get_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_canva_connection_set_v1(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_canva_connection_clear_v1() TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_canva_oauth_state_put_v1(text,text,text,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_canva_oauth_state_take_v1(text) TO service_role;
