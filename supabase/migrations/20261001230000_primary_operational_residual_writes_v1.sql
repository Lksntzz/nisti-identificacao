-- Residual operational writes moved off D1 for Supabase-primary mode.

CREATE OR REPLACE FUNCTION public.nisti_record_recognition_event_v1(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
  v_row jsonb;
  v_ok boolean;
BEGIN
  v_id := nextval(pg_get_serial_sequence('public.recognition_events','id'));
  v_row := COALESCE(p_row,'{}'::jsonb) || jsonb_build_object(
    'id',v_id,
    'created_at',COALESCE(NULLIF(p_row->>'created_at',''),now()::text)
  );
  v_ok := public.nisti_mirror_recognition_event(v_row);
  IF NOT COALESCE(v_ok,false) THEN
    RAISE EXCEPTION 'invalid recognition event payload' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('status','ok','id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_create_scan_occurrence_v1(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
  v_row jsonb;
  v_ok boolean;
BEGIN
  IF NULLIF(BTRIM(COALESCE(p_row->>'image_key','')),'') IS NULL THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;
  v_id := nextval(pg_get_serial_sequence('public.scan_occurrences','id'));
  v_row := COALESCE(p_row,'{}'::jsonb) || jsonb_build_object(
    'id',v_id,
    'status','pending',
    'created_at',COALESCE(NULLIF(p_row->>'created_at',''),now()::text)
  );
  v_ok := public.nisti_mirror_scan_occurrence(v_row);
  IF NOT COALESCE(v_ok,false) THEN
    RAISE EXCEPTION 'invalid scan occurrence payload' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object('status','ok','id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_dismiss_scan_occurrence_v1(p_id bigint)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed integer := 0;
BEGIN
  UPDATE public.scan_occurrences
  SET status='dismissed'
  WHERE id=p_id;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  IF v_changed=0 THEN RETURN jsonb_build_object('status','not_found'); END IF;
  RETURN jsonb_build_object('status','ok','id',p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_record_recognition_event_v1(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_create_scan_occurrence_v1(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_dismiss_scan_occurrence_v1(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_record_recognition_event_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_create_scan_occurrence_v1(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_dismiss_scan_occurrence_v1(bigint) TO service_role;
