begin;

alter table public.commerce_source_files
  add column if not exists mime_type text,
  add column if not exists byte_size bigint,
  add column if not exists source_blob bytea;

alter table public.commerce_preview_source_files
  add column if not exists mime_type text,
  add column if not exists byte_size bigint,
  add column if not exists source_blob bytea;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='commerce_source_files_byte_size_ck') then
    alter table public.commerce_source_files
      add constraint commerce_source_files_byte_size_ck check (byte_size is null or byte_size >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname='commerce_preview_source_files_byte_size_ck') then
    alter table public.commerce_preview_source_files
      add constraint commerce_preview_source_files_byte_size_ck check (byte_size is null or byte_size >= 0);
  end if;
end;
$$;

comment on column public.commerce_source_files.source_blob is
  'Snapshot binário opcional do arquivo original. Permite auditoria/reprocessamento sem dependência do Drive.';
comment on column public.commerce_preview_source_files.source_blob is
  'Snapshot binário opcional do arquivo original no sandbox comercial.';

commit;
