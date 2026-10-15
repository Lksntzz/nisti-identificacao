-- Security: server-only configuration and push-delivery ledger.
-- These tables are accessed by the NISTI Worker through the Supabase
-- service_role, which has BYPASSRLS. No direct browser API access is needed.
-- Do not grant SELECT/INSERT/UPDATE/DELETE policies to anon/authenticated.

BEGIN;

ALTER TABLE public.commerce_marketplace_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_push_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mural_push_release_gate ENABLE ROW LEVEL SECURITY;

-- commerce_marketplace_accounts formerly inherited ALL privileges for
-- anonymous and authenticated clients. Revoke all table privileges, not
-- only SELECT, so that DML, TRUNCATE, REFERENCES and TRIGGER are blocked.
REVOKE ALL PRIVILEGES ON TABLE
  public.commerce_marketplace_accounts,
  public.mural_push_deliveries,
  public.mural_push_release_gate
FROM PUBLIC, anon, authenticated;

-- Keep the existing Worker RPCs operational. There is no direct end-user
-- access to these tables; the backend uses service_role and explicitly
-- protected RPCs. The owner (postgres) retains its normal privileges.
GRANT ALL PRIVILEGES ON TABLE
  public.commerce_marketplace_accounts,
  public.mural_push_deliveries,
  public.mural_push_release_gate
TO service_role;

COMMIT;
