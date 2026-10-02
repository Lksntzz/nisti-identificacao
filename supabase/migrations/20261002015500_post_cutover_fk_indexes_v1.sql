-- Cover active foreign-key lookup/delete paths after the Supabase primary cutover.

CREATE INDEX IF NOT EXISTS idx_gtin_scan_events_product_id
  ON public.gtin_scan_events(product_id);

CREATE INDEX IF NOT EXISTS commerce_sales_import_batches_snapshot_id_idx
  ON public.commerce_sales_import_batches(snapshot_id);
