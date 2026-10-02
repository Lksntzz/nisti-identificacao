-- Remove retired external-model budget artifacts and obsolete Gemini-named Mural RPC aliases.
DROP FUNCTION IF EXISTS public.nisti_reserve_legacy_model_budget(TEXT, BIGINT, INTEGER);
DROP FUNCTION IF EXISTS public.nisti_reserve_gemini_budget(TEXT, BIGINT, INTEGER);
DROP TABLE IF EXISTS public.legacy_model_call_budget;
DROP TABLE IF EXISTS public.gemini_call_budget;

DROP FUNCTION IF EXISTS public.nisti_admin_mural_gemini_product_v1(bigint);
DROP FUNCTION IF EXISTS public.nisti_admin_mural_gemini_collection_v1(bigint);
