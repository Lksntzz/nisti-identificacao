-- Repair drift after commerce catalog rows were imported with explicit IDs.
-- This does not insert, update or remove products, links, EANs or sales.
-- Hold a short write lock to prevent a concurrent automatic ID allocation
-- while moving the identity sequence forward to at least the highest used ID.
begin;
lock table public.commerce_products in share row exclusive mode;
select setval(
  pg_get_serial_sequence('public.commerce_products','id')::regclass,
  greatest(
    coalesce((select max(id) from public.commerce_products),1),
    coalesce((select last_value from public.commerce_products_id_seq),1)
  ),
  true
);
commit;
