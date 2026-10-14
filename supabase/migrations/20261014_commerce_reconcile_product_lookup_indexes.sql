-- Deterministic name normalization was evaluated for every product on every
-- workbook row. Index the same immutable expressions used by the matcher.
create index if not exists commerce_products_match_key_lookup_idx
  on public.commerce_products (public.commerce_match_key_v1(name));
create index if not exists commerce_products_yearless_match_key_lookup_idx
  on public.commerce_products (public.commerce_yearless_match_key_v1(name));
