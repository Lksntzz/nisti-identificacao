-- Security hardening: sequences are internal implementation details and must
-- not permit unauthenticated/ordinary user roles to SELECT, USAGE or UPDATE.
-- No DML on catalog, scanner, EAN, orders, or records. Service role retains use.
DO $privileges$
DECLARE seq record;
BEGIN
  FOR seq IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='S'
    ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM anon, authenticated',seq.relname);
  END LOOP;
END
$privileges$;

-- Stop newly created public sequences from inheriting the same broad grants.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
-- Migration operator postgres cannot alter defaults owned by supabase_admin.
-- Its future sequence ACLs require an authorized supabase_admin maintenance action.
-- This is tracked as an outstanding item; do not pretend it is hardened here.

-- Only internal service_role can use existing sequences via Worker Supabase RPC.
-- Leave the explicit pre-existing service_role permissions untouched.
