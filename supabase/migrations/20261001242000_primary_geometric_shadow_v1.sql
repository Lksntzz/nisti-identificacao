CREATE OR REPLACE FUNCTION public.nisti_reconcile_trained_shadow_v1(
  p_occurrence_id bigint
) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT upper(BTRIM(trained_capa_code))
  INTO v_code
  FROM public.scan_occurrences
  WHERE id=p_occurrence_id
    AND status='trained'
    AND NULLIF(BTRIM(trained_capa_code),'') IS NOT NULL
  LIMIT 1;

  IF v_code IS NULL THEN RETURN 0; END IF;

  RETURN public.nisti_mirror_confirm_geometric_shadow(
    p_occurrence_id,
    NULL,
    v_code,
    'reconciled_trained_occurrence',
    now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.nisti_record_geometric_shadow_evidence_v1(
  p_row jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_token text:=NULLIF(BTRIM(p_row->>'evidence_token'),'');
  v_id bigint;
  v_occurrence_id bigint:=NULLIF(p_row->>'occurrence_id','')::bigint;
  v_ok boolean;
BEGIN
  IF v_token IS NULL THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  SELECT id INTO v_id
  FROM public.geometric_shadow_evidence
  WHERE evidence_token=v_token
  LIMIT 1;

  IF v_id IS NULL THEN
    v_id:=nextval(pg_get_serial_sequence('public.geometric_shadow_evidence','id'));
  END IF;

  v_ok:=public.nisti_mirror_geometric_shadow_evidence(
    COALESCE(p_row,'{}'::jsonb) || jsonb_build_object('id',v_id)
  );

  IF NOT COALESCE(v_ok,false) THEN
    RETURN jsonb_build_object('status','invalid');
  END IF;

  IF v_occurrence_id IS NOT NULL THEN
    PERFORM public.nisti_reconcile_trained_shadow_v1(v_occurrence_id);
  END IF;

  RETURN jsonb_build_object('status','ok','id',v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_reconcile_trained_shadow_v1(bigint)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.nisti_record_geometric_shadow_evidence_v1(jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_reconcile_trained_shadow_v1(bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.nisti_record_geometric_shadow_evidence_v1(jsonb)
  TO service_role;
