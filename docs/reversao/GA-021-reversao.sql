-- GA-021 — PROCEDIMENTO DE REVERSÃO (NÃO é migração; não fica em supabase/migrations).
-- Use só se a migração 20261124150000 causar problema. NÃO é restauração do banco (ver docs/cerebro/backup.md: restauração integral exige reaplicar permissões). Rodar no SQL Editor do Supabase, depois do backup externo.
-- O que faz: devolve as dez funções à leitura da tabela legada crua (o inverso exato da troca feita pela migração).
-- ATENÇÃO: isso REINTRODUZ o defeito (lotes abertos e versões antigas voltam a ser somados em Categorias, Curva ABC e frete).
-- Não apaga nem altera nenhuma venda, lote, snapshot ou tabela. A view e a função novas ficam (inofensivas, ninguém as chama).
-- Depois de rodar: conferir que o texto das funções cita commerce_shopee_sales_sku_daily_v1 e esperar 5 min (ou ?fresh=1).
do $rb$
declare r record; v text; n int := 0;
begin
  for r in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = any(array[
      'commerce_annual_compare_coverage_v1','commerce_annual_compare_v1','commerce_categories_col_v2','commerce_categories_sub_v2',
      'commerce_categories_timeline_v1','commerce_categories_v2','commerce_dashboard_abc_v2','commerce_dashboard_shipping_split_v1',
      'commerce_period_v1','commerce_sku_prior_map_v1']) loop
    v := pg_get_functiondef(r.oid);
    if position('public.commerce_shopee_current_sku_daily_v1' in v) > 0 then
      execute replace(v, 'public.commerce_shopee_current_sku_daily_v1', 'public.commerce_shopee_sales_sku_daily_v1');
      n := n + 1;
    end if;
  end loop;
  raise notice 'GA-021 reversao: % funcoes revertidas (esperado: 10)', n;
  if to_regclass('public.commerce_read_cache_v1') is not null then
    delete from public.commerce_read_cache_v1
      where cache_key like 'commerce_dashboard_abc_v2|%' or cache_key like 'commerce_categories_v2|%'
         or cache_key like 'commerce_categories_timeline_v1|%' or cache_key like 'commerce_dashboard_shipping_split_v1|%';
  end if;
end $rb$;
-- Para reaplicar a GA-021 depois: rodar de novo a migração 20261124150000 (é idempotente).
