-- The scanner now calls a Supabase Edge Function instead of a browser-executable
-- SECURITY DEFINER RPC. Remove the temporary public database surface.

REVOKE ALL ON FUNCTION public.nisti_public_gtin_lookup_v1(text) FROM PUBLIC, anon, authenticated;
DROP FUNCTION public.nisti_public_gtin_lookup_v1(text);
