-- Retire QA-only notification persistence and RPCs after removal of QA APIs/UI.
-- Production push subscriptions and the real Mural delivery ledger are untouched.
DROP FUNCTION IF EXISTS public.nisti_claim_adm_lukas_mural_push_test_v1();
DROP FUNCTION IF EXISTS public.nisti_claim_operator_push_self_test_v1(text);
DROP FUNCTION IF EXISTS public.nisti_open_operator_push_test_v1(uuid,text);
DROP FUNCTION IF EXISTS public.nisti_ack_operator_push_test_v1(uuid,text,text);
DROP FUNCTION IF EXISTS public.nisti_get_operator_push_test_v1(uuid,text);
DROP TABLE IF EXISTS public.operator_push_test_receipts;
DROP TABLE IF EXISTS public.mural_push_test_cooldowns;
