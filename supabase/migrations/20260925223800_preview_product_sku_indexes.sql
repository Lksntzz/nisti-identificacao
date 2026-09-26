create index if not exists commerce_preview_product_skus_norm_idx
on public.commerce_preview_product_skus (
  (regexp_replace(upper(sku),'[^A-Z0-9]+','','g'))
);

create index if not exists commerce_preview_product_skus_signature_idx
on public.commerce_preview_product_skus (
  ((public.commerce_sku_pattern_v1(sku)->>'signature'))
);

create index if not exists commerce_preview_product_skus_base_signature_idx
on public.commerce_preview_product_skus (
  ((public.commerce_sku_pattern_v1(sku)->>'base_signature'))
);

analyze public.commerce_preview_product_skus;
