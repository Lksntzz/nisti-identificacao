-- Reconcile live D1 snapshot schema with Supabase.
-- The authoritative D1 export contains operator_name/operator_id on scan_occurrences,
-- while the initial PostgreSQL baseline omitted them.

ALTER TABLE public.scan_occurrences
  ADD COLUMN operator_name TEXT,
  ADD COLUMN operator_id TEXT;
