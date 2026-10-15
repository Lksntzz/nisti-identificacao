-- The Scanner keeps its historical product_platforms for identification.
-- Its Commerce bridge is only allowed to create/update catalog rows when
-- imported marketplace data actually exists in the Commerce database.
-- Platform badges themselves continue to originate from commerce source rows.
CREATE OR REPLACE FUNCTION public.commerce_has_marketplace_import_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.commerce_source_files sf
    JOIN public.commerce_source_rows sr ON sr.source_file_id = sf.id
    WHERE sr.is_header = false
  ) OR EXISTS (
    SELECT 1 FROM public.commerce_listings
  );
$$;

REVOKE EXECUTE ON FUNCTION public.commerce_has_marketplace_import_v1()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_has_marketplace_import_v1()
TO service_role;
