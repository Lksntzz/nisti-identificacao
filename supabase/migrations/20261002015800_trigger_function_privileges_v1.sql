-- Trigger helpers are internal database implementation details.
-- Keep them executable only by the server-side service role.

REVOKE ALL ON FUNCTION public.commerce_nisti_link_apply_trigger_v1()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.commerce_source_row_nisti_canonicalize_v1()
  FROM PUBLIC,anon,authenticated;

GRANT EXECUTE ON FUNCTION public.commerce_nisti_link_apply_trigger_v1()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.commerce_source_row_nisti_canonicalize_v1()
  TO service_role;
