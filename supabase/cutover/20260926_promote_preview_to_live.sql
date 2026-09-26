-- MANUAL PRODUCTION CUTOVER.
-- This file is intentionally outside supabase/migrations so it cannot run by accident.
-- Preconditions: preview review queue must be closed and production publication must be explicitly authorized.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $$
declare
  s jsonb;
begin
  s := public.commerce_preview_management_product_summary_v2();

  if coalesce((s ->> 'unlinked')::int, -1) <> 0
     or coalesce((s ->> 'safe_candidates')::int, -1) <> 0
     or coalesce((s ->> 'no_safe_candidate')::int, -1) <> 0
     or coalesce((s ->> 'ambiguous_candidates')::int, -1) <> 0 then
    raise exception 'Commerce preview is not ready for production cutover: %', s;
  end if;

  if coalesce((s ->> 'linked_products')::int, 0) <= 0 then
    raise exception 'Commerce preview has no linked products: %', s;
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

do $$
begin
  if to_regnamespace('commerce_cutover_backup_20260926') is not null then
    raise exception 'Backup schema commerce_cutover_backup_20260926 already exists. Refusing to overwrite it.';
  end if;
end
$$;

create schema commerce_cutover_backup_20260926;

create table commerce_cutover_backup_20260926.commerce_categories as table public.commerce_categories;
create table commerce_cutover_backup_20260926.commerce_subcategories as table public.commerce_subcategories;
create table commerce_cutover_backup_20260926.commerce_marketplaces as table public.commerce_marketplaces;
create table commerce_cutover_backup_20260926.commerce_source_files as table public.commerce_source_files;
create table commerce_cutover_backup_20260926.commerce_products as table public.commerce_products;
create table commerce_cutover_backup_20260926.commerce_product_skus as table public.commerce_product_skus;
create table commerce_cutover_backup_20260926.commerce_listings as table public.commerce_listings;
create table commerce_cutover_backup_20260926.commerce_import_batches as table public.commerce_import_batches;
create table commerce_cutover_backup_20260926.commerce_listing_products as table public.commerce_listing_products;
create table commerce_cutover_backup_20260926.commerce_marketplace_snapshots as table public.commerce_marketplace_snapshots;
create table commerce_cutover_backup_20260926.commerce_product_media_links as table public.commerce_product_media_links;
create table commerce_cutover_backup_20260926.commerce_product_state_events as table public.commerce_product_state_events;
create table commerce_cutover_backup_20260926.commerce_import_rows as table public.commerce_import_rows;
create table commerce_cutover_backup_20260926.commerce_source_rows as table public.commerce_source_rows;
create table commerce_cutover_backup_20260926.commerce_reconciliation_candidates as table public.commerce_reconciliation_candidates;
create table commerce_cutover_backup_20260926.commerce_update_campaigns as table public.commerce_update_campaigns;
create table commerce_cutover_backup_20260926.commerce_update_items as table public.commerce_update_items;
create table commerce_cutover_backup_20260926.commerce_update_checks as table public.commerce_update_checks;

create table commerce_cutover_backup_20260926.function_defs (
  proname text not null,
  identity_args text not null,
  definition text not null,
  primary key (proname, identity_args)
);

insert into commerce_cutover_backup_20260926.function_defs(proname, identity_args, definition)
select
  p.proname,
  pg_get_function_identity_arguments(p.oid),
  pg_get_functiondef(p.oid)
from pg_proc p
where p.pronamespace='public'::regnamespace
  and p.proname in (
    'commerce_management_products_v2',
    'commerce_management_product_summary_v2',
    'commerce_management_link_candidates_v1',
    'commerce_management_link_candidates_v2'
  );

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

insert into public.commerce_categories select * from public.commerce_preview_categories;
insert into public.commerce_subcategories select * from public.commerce_preview_subcategories;
insert into public.commerce_marketplaces select * from public.commerce_preview_marketplaces;
insert into public.commerce_source_files select * from public.commerce_preview_source_files;
insert into public.commerce_update_campaigns select * from public.commerce_preview_update_campaigns;
insert into public.commerce_products select * from public.commerce_preview_products;
insert into public.commerce_product_skus select * from public.commerce_preview_product_skus;
insert into public.commerce_listings select * from public.commerce_preview_listings;
insert into public.commerce_import_batches select * from public.commerce_preview_import_batches;
insert into public.commerce_listing_products select * from public.commerce_preview_listing_products;
insert into public.commerce_marketplace_snapshots select * from public.commerce_preview_marketplace_snapshots;
insert into public.commerce_product_media_links select * from public.commerce_preview_product_media_links;
insert into public.commerce_product_state_events select * from public.commerce_preview_product_state_events;
insert into public.commerce_import_rows select * from public.commerce_preview_import_rows;
insert into public.commerce_source_rows select * from public.commerce_preview_source_rows;
insert into public.commerce_reconciliation_candidates select * from public.commerce_preview_reconciliation_candidates;
insert into public.commerce_update_items select * from public.commerce_preview_update_items;
insert into public.commerce_update_checks select * from public.commerce_preview_update_checks;

do $
declare
  r record;
  promoted_definition text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    where p.pronamespace='public'::regnamespace
      and p.proname in (
        'commerce_preview_management_products_v2',
        'commerce_preview_management_product_summary_v2',
        'commerce_preview_management_link_candidates_v1',
        'commerce_preview_management_link_candidates_v2'
      )
    order by
      case p.proname
        when 'commerce_preview_management_products_v2' then 1
        when 'commerce_preview_management_product_summary_v2' then 2
        when 'commerce_preview_management_link_candidates_v1' then 3
        when 'commerce_preview_management_link_candidates_v2' then 4
        else 9
      end
  loop
    promoted_definition := replace(pg_get_functiondef(r.oid), 'commerce_preview_', 'commerce_');
    execute promoted_definition;
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
  preview_count bigint;
  live_summary jsonb;
  preview_summary jsonb;
  metric text;
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
    execute format('select count(*) from public.%I', 'commerce_preview_' || suffix) into preview_count;

    if live_count <> preview_count then
      raise exception 'Cutover row-count mismatch for %: live %, preview %',
        live_table, live_count, preview_count;
    end if;
  end loop;

  live_summary := public.commerce_management_product_summary_v2();
  preview_summary := public.commerce_preview_management_product_summary_v2();

  foreach metric in array array[
    'unlinked','exclusive','multiplatform','linked_products','safe_candidates',
    'no_safe_candidate','ambiguous_candidates','gs_reference_matches'
  ]
  loop
    if coalesce(live_summary ->> metric, '') <> coalesce(preview_summary ->> metric, '') then
      raise exception 'Cutover summary mismatch for %: live %, preview %',
        metric, live_summary ->> metric, preview_summary ->> metric;
    end if;
  end loop;

  if coalesce((live_summary ->> 'unlinked')::int, -1) <> 0 then
    raise exception 'Cutover finished with unlinked products: %', live_summary;
  end if;
end
$$;

commit;
