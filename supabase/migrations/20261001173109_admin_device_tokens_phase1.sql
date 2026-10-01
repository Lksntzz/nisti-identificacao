create table if not exists public.nisti_admin_device_tokens (
  token_hash text primary key,
  label text not null default 'browser',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  check (char_length(token_hash) = 64),
  check (expires_at > created_at)
);

alter table public.nisti_admin_device_tokens enable row level security;

revoke all on table public.nisti_admin_device_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.nisti_admin_device_tokens to service_role;

create index if not exists nisti_admin_device_tokens_active_idx
  on public.nisti_admin_device_tokens (expires_at)
  where revoked_at is null;
