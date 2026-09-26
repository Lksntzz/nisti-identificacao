-- MANUAL ROLLBACK for supabase/cutover/20260926_promote_preview_to_live.sql
-- Keeps the backup schema after rollback for audit/verification.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
begin
  if to_regnamespace('commerce_cutover_backup_20260926') is null then
    raise exception 'Backup schema commerce_cutover_backup_20260926 does not exist.';
  end if;
end
$$;

lock table
  public.commerce_categories,
  public.commerce_subcategories,
  public.commerce_marketplaces,
  public.commerce_source_files,
  public.commerce_products,
  public.commerce_product_skus,
  public.commerce_listings,
  public.commerce_import_batches,
  public.commerce_listing_products,
  public.commerce_marketplace_snapshots,
  public.commerce_product_media_links,
  public.commerce_product_state_events,
  public.commerce_import_rows,
  public.commerce_source_rows,
  public.commerce_reconciliation_candidates,
  public.commerce_update_campaigns,
  public.commerce_update_items,
  public.commerce_update_checks
in access exclusive mode;

truncate table
  public.commerce_update_checks,
  public.commerce_update_items,
  public.commerce_reconciliation_candidates,
  public.commerce_import_rows,
  public.commerce_source_rows,
  public.commerce_marketplace_snapshots,
  public.commerce_listing_products,
  public.commerce_product_media_links,
  public.commerce_product_state_events,
  public.commerce_product_skus,
  public.commerce_listings,
  public.commerce_import_batches,
  public.commerce_products,
  public.commerce_update_campaigns,
  public.commerce_subcategories,
  public.commerce_categories,
  public.commerce_source_files,
  public.commerce_marketplaces
restart identity;

insert into public.commerce_categories select * from commerce_cutover_backup_20260926.commerce_categories;
insert into public.commerce_subcategories select * from commerce_cutover_backup_20260926.commerce_subcategories;
insert into public.commerce_marketplaces select * from commerce_cutover_backup_20260926.commerce_marketplaces;
insert into public.commerce_source_files select * from commerce_cutover_backup_20260926.commerce_source_files;
insert into public.commerce_update_campaigns select * from commerce_cutover_backup_20260926.commerce_update_campaigns;
insert into public.commerce_products select * from commerce_cutover_backup_20260926.commerce_products;
insert into public.commerce_product_skus select * from commerce_cutover_backup_20260926.commerce_product_skus;
insert into public.commerce_listings select * from commerce_cutover_backup_20260926.commerce_listings;
insert into public.commerce_import_batches select * from commerce_cutover_backup_20260926.commerce_import_batches;
insert into public.commerce_listing_products select * from commerce_cutover_backup_20260926.commerce_listing_products;
insert into public.commerce_marketplace_snapshots select * from commerce_cutover_backup_20260926.commerce_marketplace_snapshots;
insert into public.commerce_product_media_links select * from commerce_cutover_backup_20260926.commerce_product_media_links;
insert into public.commerce_product_state_events select * from commerce_cutover_backup_20260926.commerce_product_state_events;
insert into public.commerce_import_rows select * from commerce_cutover_backup_20260926.commerce_import_rows;
insert into public.commerce_source_rows select * from commerce_cutover_backup_20260926.commerce_source_rows;
insert into public.commerce_reconciliation_candidates select * from commerce_cutover_backup_20260926.commerce_reconciliation_candidates;
insert into public.commerce_update_items select * from commerce_cutover_backup_20260926.commerce_update_items;
insert into public.commerce_update_checks select * from commerce_cutover_backup_20260926.commerce_update_checks;

do $
declare
  r record;
begin
  for r in
    select definition
    from commerce_cutover_backup_20260926.function_defs
    order by proname, identity_args
  loop
    execute r.definition;
  end loop;
end
$;

do $
declare
  suffix text;
  live_table text;
  seq_name text;
  max_id bigint;
  live_count bigint;
  backup_count bigint;
begin
  foreach suffix in array array[
    'categories','subcategories','marketplaces','source_files','products','product_skus',
    'listings','import_batches','listing_products','marketplace_snapshots',
    'product_media_links','product_state_events','import_rows','source_rows',
    'reconciliation_candidates','update_campaigns','update_items','update_checks'
  ]
  loop
    live_table := 'commerce_' || suffix;

    seq_name := pg_get_serial_sequence('public.' || live_table, 'id');
    if seq_name is not null then
      execute format('select coalesce(max(id), 0) from public.%I', live_table) into max_id;
      perform setval(seq_name, greatest(max_id, 1), max_id > 0);
    end if;

    execute format('select count(*) from public.%I', live_table) into live_count;
    execute format('select count(*) from commerce_cutover_backup_20260926.%I', live_table) into backup_count;

    if live_count <> backup_count then
      raise exception 'Rollback row-count mismatch for %: live %, backup %',
        live_table, live_count, backup_count;
    end if;
  end loop;
end
$$;

commit;
