-- GA: listas de produtos e detalhe de plataformas passam a considerar apenas anuncios ATIVOS.
-- Nada e apagado; anuncio que voltar a ficar ativo reaparece sozinho.
do $$
declare d text; f text;
begin
  foreach f in array array[
    'commerce_list_products_v1',
    'commerce_list_products_planning_v1',
    'commerce_product_platform_detail_v2'
  ] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p
      where p.proname = f and p.pronamespace = 'public'::regnamespace;
    d := replace(d, 'l_filter.listing_status <> ''REMOVED''', 'l_filter.listing_status = ''ACTIVE''');
    d := replace(d, 'l.listing_status <> ''REMOVED''', 'l.listing_status = ''ACTIVE''');
    d := replace(d, 'l.listing_status<>''REMOVED''', 'l.listing_status=''ACTIVE''');
    execute d;
  end loop;
end $$;
