-- Operator PIN access: one factor (personal numeric PIN), never plain-text PINs.
-- Staged deployment: enforcement stays OFF until an admin provisions operators.
-- No changes to NISTI identification, Scanner/EAN product tables or legacy data.

CREATE TABLE IF NOT EXISTS public.nisti_operator_pin_accounts (
  operator_id text PRIMARY KEY DEFAULT ('op_'||gen_random_uuid()::text),
  display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 2 AND 80),
  pin_digest text NOT NULL UNIQUE CHECK (pin_digest ~ '^[0-9a-f]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nisti_operator_pin_id_valid CHECK (
    operator_id ~* '^op_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
);
ALTER TABLE public.nisti_operator_pin_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nisti_operator_pin_accounts FROM public,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.nisti_operator_pin_accounts TO service_role;

CREATE TABLE IF NOT EXISTS public.nisti_operator_pin_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  pin_required boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nisti_operator_pin_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nisti_operator_pin_settings FROM public,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.nisti_operator_pin_settings TO service_role;
INSERT INTO public.nisti_operator_pin_settings(singleton,pin_required)
  VALUES (true,false) ON CONFLICT(singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_required_v1()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
  SELECT coalesce((SELECT pin_required FROM public.nisti_operator_pin_settings
    WHERE singleton=true),false)
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_signin_v1(p_digest text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
  SELECT jsonb_build_object('id',operator_id,'name',display_name,'version',credential_version)
  FROM public.nisti_operator_pin_accounts
  WHERE pin_digest=p_digest AND enabled=true LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_session_v1(p_id text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
  SELECT jsonb_build_object('id',operator_id,'name',display_name,'version',credential_version)
  FROM public.nisti_operator_pin_accounts
  WHERE operator_id=p_id AND enabled=true LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_admin_list_v1()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
  SELECT jsonb_build_object(
    'required',public.nisti_operator_pin_required_v1(),
    'operators',coalesce((SELECT jsonb_agg(
      jsonb_build_object('id',operator_id,'name',display_name,'enabled',enabled,'created_at',created_at)
      ORDER BY display_name,operator_id)
      FROM public.nisti_operator_pin_accounts),'[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_create_v1(p_name text,p_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
DECLARE out_row public.nisti_operator_pin_accounts%ROWTYPE;
BEGIN
  IF length(btrim(coalesce(p_name,''))) NOT BETWEEN 2 AND 80
    OR p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid operator credential' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.nisti_operator_pin_accounts(display_name,pin_digest)
  VALUES (btrim(p_name),p_digest) RETURNING * INTO out_row;
  RETURN jsonb_build_object('id',out_row.operator_id,'name',out_row.display_name,
     'enabled',out_row.enabled);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_set_enabled_v1(p_id text,p_enabled boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
DECLARE changed integer;
BEGIN
  UPDATE public.nisti_operator_pin_accounts
    SET enabled=coalesce(p_enabled,false),credential_version=credential_version+1,
      updated_at=now()
  WHERE operator_id=p_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_rotate_v1(p_id text,p_digest text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
DECLARE changed integer;
BEGIN
  IF p_digest IS NULL OR p_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid credential' USING ERRCODE='22023';
  END IF;
  UPDATE public.nisti_operator_pin_accounts
    SET pin_digest=p_digest,credential_version=credential_version+1,updated_at=now()
  WHERE operator_id=p_id AND enabled=true;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_operator_pin_enforce_v1(p_required boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public','pg_temp'
AS $$
BEGIN
  IF coalesce(p_required,false)
    AND NOT EXISTS (SELECT 1 FROM public.nisti_operator_pin_accounts WHERE enabled=true) THEN
    RAISE EXCEPTION 'at least one enabled PIN account is required'
      USING ERRCODE='23514';
  END IF;
  UPDATE public.nisti_operator_pin_settings
  SET pin_required=coalesce(p_required,false),updated_at=now() WHERE singleton=true;
  RETURN public.nisti_operator_pin_required_v1();
END;
$$;

REVOKE ALL ON FUNCTION
  public.nisti_operator_pin_required_v1(),
  public.nisti_operator_pin_signin_v1(text),
  public.nisti_operator_pin_session_v1(text),
  public.nisti_operator_pin_admin_list_v1(),
  public.nisti_operator_pin_create_v1(text,text),
  public.nisti_operator_pin_set_enabled_v1(text,boolean),
  public.nisti_operator_pin_rotate_v1(text,text),
  public.nisti_operator_pin_enforce_v1(boolean)
FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION
  public.nisti_operator_pin_required_v1(),
  public.nisti_operator_pin_signin_v1(text),
  public.nisti_operator_pin_session_v1(text),
  public.nisti_operator_pin_admin_list_v1(),
  public.nisti_operator_pin_create_v1(text,text),
  public.nisti_operator_pin_set_enabled_v1(text,boolean),
  public.nisti_operator_pin_rotate_v1(text,text),
  public.nisti_operator_pin_enforce_v1(boolean)
TO service_role;