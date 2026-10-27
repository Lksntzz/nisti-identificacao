-- Limpeza: remove 23 funcoes SQL do GA sem nenhum uso (nao chamadas pelo codigo, por outras funcoes, por gatilhos ou agendamentos):
-- 20 versoes antigas e as 3 da aba "Evolucao de vendas" (removida da tela em 27/10/2026).
-- Seguranca: sem CASCADE (o banco recusa se algo ainda depender); aborta se outra funcao ainda citar o nome.
-- Para restaurar alguma, rode a definicao dela na migracao original em supabase/migrations/.
do $mig$
declare
 v_names text[]:=array[
  'commerce_approve_new_rows_v1','commerce_commit_import_batch_v4','commerce_import_batch_v1','commerce_ingest_shopee_snapshot_v1',
  'commerce_list_listings_v3','commerce_list_products_v2','commerce_listing_history_v1','commerce_listing_manager_month_sku_v1',
  'commerce_management_products_v1','commerce_product_platform_detail_v1','commerce_promote_preview_catalog_v1',
  'commerce_reconcile_import_batch_account_v1','commerce_reconcile_import_batch_v8','commerce_reconcile_nisti_product_v2',
  'commerce_reconcile_nisti_product_v3','commerce_reconcile_nisti_product_v4','commerce_sales_listing_performance_v1',
  'commerce_sales_velocity_v1','commerce_sync_import_listing_states_v1','commerce_sync_management_platforms_to_master_v1',
  'commerce_evolution_ads_v1','commerce_evolution_ad_weekly_v1','commerce_sales_evolution_v1'];
 r record; n int:=0;
begin
 for r in select p.oid,p.proname,p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid=p.pronamespace
          where s.nspname='public' and p.proname=any(v_names) loop
  if exists (select 1 from pg_proc g join pg_namespace gs on gs.oid=g.pronamespace
             where gs.nspname='public' and g.oid<>r.oid and g.proname<>all(v_names) and g.prosrc ~ ('\m'||r.proname||'\M'))
  then raise exception 'Funcao % ainda e citada por outra funcao; nada foi removido.',r.proname; end if;
  if exists (select 1 from pg_trigger t where t.tgfoid=r.oid and not t.tgisinternal)
  then raise exception 'Funcao % e usada por gatilho; nada foi removido.',r.proname; end if;
 end loop;
 for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace s on s.oid=p.pronamespace
          where s.nspname='public' and p.proname=any(v_names) loop
  execute 'drop function '||r.sig; n:=n+1;
 end loop;
 raise notice 'Funcoes removidas: %',n;
end $mig$;
