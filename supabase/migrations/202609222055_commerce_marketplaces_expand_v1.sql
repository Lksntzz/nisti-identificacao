begin;

insert into public.commerce_marketplaces (code, name, is_active)
values
  ('SHEIN', 'Shein', true),
  ('LOJA_INTEGRADA', 'Loja Integrada', true),
  ('KWAI', 'Kwai', true),
  ('TIKTOK', 'TikTok', true),
  ('ALIEXPRESS', 'AliExpress', true),
  ('MAGALU', 'Magalu', true)
on conflict do nothing;

insert into public.commerce_preview_marketplaces (code, name, is_active)
values
  ('SHEIN', 'Shein', true),
  ('LOJA_INTEGRADA', 'Loja Integrada', true),
  ('KWAI', 'Kwai', true),
  ('TIKTOK', 'TikTok', true),
  ('ALIEXPRESS', 'AliExpress', true),
  ('MAGALU', 'Magalu', true)
on conflict do nothing;

commit;
