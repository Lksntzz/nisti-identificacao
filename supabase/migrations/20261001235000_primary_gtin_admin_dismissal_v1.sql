CREATE OR REPLACE FUNCTION public.nisti_set_gtin_event_dismissal_primary_v1(
  p_id bigint,
  p_dismiss boolean
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_changed integer:=0;
BEGIN
  IF COALESCE(p_dismiss,false) THEN
    UPDATE public.gtin_scan_events
    SET dismissed_at=now(),dismissed_by='admin'
    WHERE id=p_id AND status='not_found' AND dismissed_at IS NULL;
  ELSE
    UPDATE public.gtin_scan_events
    SET dismissed_at=NULL,dismissed_by=NULL
    WHERE id=p_id AND status='not_found' AND dismissed_at IS NOT NULL;
  END IF;
  GET DIAGNOSTICS v_changed=ROW_COUNT;
  RETURN v_changed>0;
END;
$$;

REVOKE ALL ON FUNCTION public.nisti_set_gtin_event_dismissal_primary_v1(bigint,boolean)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.nisti_set_gtin_event_dismissal_primary_v1(bigint,boolean)
  TO service_role;
