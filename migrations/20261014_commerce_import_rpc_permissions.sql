-- Mutations and reconciliation helpers are backend-only.
revoke execute on function public.commerce_reconcile_import_batch_v6(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_reconcile_import_batch_v7(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_reconcile_import_batch_v8(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_commit_import_batch_v4(bigint) from public, anon, authenticated;
revoke execute on function public.commerce_sync_import_listing_states_v1(bigint) from public, anon, authenticated;
grant execute on function public.commerce_reconcile_import_batch_v6(bigint) to service_role;
grant execute on function public.commerce_reconcile_import_batch_v7(bigint) to service_role;
grant execute on function public.commerce_reconcile_import_batch_v8(bigint) to service_role;
grant execute on function public.commerce_commit_import_batch_v4(bigint) to service_role;
grant execute on function public.commerce_sync_import_listing_states_v1(bigint) to service_role;
