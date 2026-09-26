-- Defense in depth for commerce tables exposed through the public schema.
-- These tables are accessed by the Worker with the server-side service_role.
-- No anon/authenticated policies are intentionally added here.

alter table public.commerce_product_state_events enable row level security;
alter table public.commerce_preview_product_state_events enable row level security;
alter table public.commerce_marketplace_snapshots enable row level security;
alter table public.commerce_preview_marketplace_snapshots enable row level security;
alter table public.commerce_product_media_links enable row level security;
alter table public.commerce_preview_product_media_links enable row level security;
