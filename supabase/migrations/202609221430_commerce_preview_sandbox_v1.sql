begin;

-- Sandbox lógico gratuito para a Worker Preview.
-- As tabelas e RPCs commerce_preview_* vivem no mesmo projeto Supabase,
-- mas não compartilham dados com o catálogo definitivo commerce_*.

do $$
declare
  r record;
  target_name text;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like 'commerce\_%' escape '\'
      and tablename not like 'commerce\_preview\_%' escape '\'
    order by tablename
  loop
    target_name := regexp_replace(r.tablename, '^commerce_', 'commerce_preview_');
    if to_regclass(format('public.%I', target_name)) is null then
      execute format(
        'create table public.%I (like public.%I including all)',
        target_name,
        r.tablename
      );
    end if;
  end loop;
end;
$$;

insert into public.commerce_preview_marketplaces (code, name, is_active)
select code, name, is_active
from public.commerce_marketplaces
on conflict do nothing;

-- Replica as RPCs/funções comerciais atuais trocando apenas o namespace lógico.
-- Isso evita manter uma segunda implementação divergente das regras de negócio.
do $$
declare
  r record;
  definition text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'commerce\_%' escape '\'
      and p.proname not like 'commerce\_preview\_%' escape '\'
    order by p.proname, p.oid
  loop
    definition := pg_get_functiondef(r.oid);
    definition := replace(definition, 'commerce_', 'commerce_preview_');
    execute definition;
  end loop;
end;
$$;

-- O sandbox é server-only: sem acesso direto de anon/authenticated.
do $$
declare
  r record;
  seq_name text;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and tablename like 'commerce\_preview\_%' escape '\'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
    execute format('revoke all on table public.%I from public, anon, authenticated', r.tablename);
    execute format('grant all on table public.%I to service_role', r.tablename);

    seq_name := pg_get_serial_sequence(format('public.%I', r.tablename), 'id');
    if seq_name is not null then
      execute format('grant usage, select on sequence %s to service_role', seq_name);
    end if;
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'commerce\_preview\_%' escape '\'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end;
$$;

commit;
