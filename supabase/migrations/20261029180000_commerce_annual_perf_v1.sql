-- Desempenho do comparativo anual: índice na busca de nome por SKU normalizado e funções sem varrer a view de anúncios quando a plataforma é Shopee.
create index if not exists commerce_product_skus_canon_idx on public.commerce_product_skus (upper(regexp_replace(sku,'[\s_]+','','g')));
analyze public.commerce_product_skus;
-- As funções commerce_annual_compare_v1 e commerce_annual_month_v1 foram reescritas por patch (pg_get_functiondef + replace):
--  1) ano de referência vem da tabela diária da Shopee (e não da view de anúncios);
--  2) o ramo Mercado Livre só é lido quando p_platform <> 'SHOPEE';
--  3) o nome do produto só é buscado para os SKUs que aparecem em "mais cresceram / mais caíram".
-- Resultado medido: 2.085 ms -> ~700 ms (Shopee, por mês); mesmos totais.
