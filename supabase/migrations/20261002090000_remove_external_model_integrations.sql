-- Remove the retired external-model integration and keep only generic Mural reference readers.
DROP FUNCTION IF EXISTS public.nisti_reserve_legacy_model_budget(TEXT, BIGINT, INTEGER);
DROP FUNCTION IF EXISTS public.nisti_reserve_gemini_budget(TEXT, BIGINT, INTEGER);
DROP TABLE IF EXISTS public.legacy_model_call_budget;
DROP TABLE IF EXISTS public.gemini_call_budget;

DO $$
BEGIN
  IF to_regprocedure('public.nisti_admin_mural_gemini_product_v1(bigint)') IS NOT NULL
     AND to_regprocedure('public.nisti_admin_mural_product_reference_v1(bigint)') IS NULL THEN
    ALTER FUNCTION public.nisti_admin_mural_gemini_product_v1(bigint)
      RENAME TO nisti_admin_mural_product_reference_v1;
  END IF;
  IF to_regprocedure('public.nisti_admin_mural_gemini_collection_v1(bigint)') IS NOT NULL
     AND to_regprocedure('public.nisti_admin_mural_collection_reference_v1(bigint)') IS NULL THEN
    ALTER FUNCTION public.nisti_admin_mural_gemini_collection_v1(bigint)
      RENAME TO nisti_admin_mural_collection_reference_v1;
  END IF;
END;
$$;
