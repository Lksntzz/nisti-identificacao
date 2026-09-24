begin;

create index if not exists commerce_import_rows_matched_listing_idx
  on public.commerce_import_rows (matched_listing_id)
  where matched_listing_id is not null;

create index if not exists commerce_listing_products_product_sku_fk_idx
  on public.commerce_listing_products (product_sku_id, product_id)
  where product_sku_id is not null;

create index if not exists commerce_products_subcategory_fk_idx
  on public.commerce_products (subcategory_id, category_id)
  where subcategory_id is not null;

create index if not exists commerce_reconciliation_candidates_product_idx
  on public.commerce_reconciliation_candidates (product_id);

create index if not exists commerce_update_items_listing_product_idx
  on public.commerce_update_items (listing_product_id);

commit;
