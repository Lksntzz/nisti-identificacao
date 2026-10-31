-- A busca de anúncios pelo código da plataforma lia a tabela inteira a cada linha de venda.
create index if not exists commerce_listings_external_listing_idx on public.commerce_listings (external_listing_id);
analyze public.commerce_listings;
