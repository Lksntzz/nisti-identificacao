-- Seguranca dos dados do GA dentro do plano FREE do Supabase:
-- (1) copia semanal automatica das tabelas criticas (schema "backup", guarda as 4 ultimas);
-- (2) historico de alteracoes (quando, antes e depois) do catalogo de produtos e anuncios, com limpeza automatica.
-- Nao altera nenhuma tabela existente alem de adicionar gatilhos de leitura/registro. Nada fica exposto na API publica.

create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists backup;
revoke all on schema backup from public,anon,authenticated;
create table if not exists backup.snapshots (
 id bigint generated always as identity primary key,
 taken_at timestamptz not null default now(),
 tables jsonb not null default '{}'::jsonb,
 total_rows bigint not null default 0,
 total_bytes bigint not null default 0
);
revoke all on backup.snapshots from public,anon,authenticated;

create or replace function backup.take_snapshot_v1(p_keep int default 4)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,backup
as $fn$
declare
 v_id bigint; v_t text; v_rows bigint; v_bytes bigint; v_tab jsonb:='{}'::jsonb; v_tr bigint:=0; v_tb bigint:=0; r record;
 v_list text[]:=array['commerce_marketplaces','commerce_categories','commerce_subcategories','commerce_products','commerce_product_skus',
   'commerce_listings','commerce_listing_products','commerce_nisti_product_links','commerce_product_state_events',
   'commerce_sales_listing_daily_v1','commerce_shopee_sales_sku_daily_v1','commerce_shopee_finance_daily_v1'];
begin
 if p_keep is null or p_keep not between 2 and 8 then raise exception 'p_keep deve ficar entre 2 e 8.'; end if;
 insert into backup.snapshots default values returning id into v_id;
 foreach v_t in array v_list loop
  if to_regclass('public.'||v_t) is null then continue; end if;
  execute format('create table backup.%I as select * from public.%I',('s'||v_id||'__'||v_t),v_t);
  execute format('select count(*), pg_total_relation_size(%L) from backup.%I',('backup.s'||v_id||'__'||v_t),('s'||v_id||'__'||v_t)) into v_rows,v_bytes;
  execute format('revoke all on backup.%I from public,anon,authenticated',('s'||v_id||'__'||v_t));
  v_tab:=v_tab||jsonb_build_object(v_t,jsonb_build_object('rows',v_rows,'bytes',v_bytes));
  v_tr:=v_tr+v_rows; v_tb:=v_tb+v_bytes;
 end loop;
 update backup.snapshots set tables=v_tab,total_rows=v_tr,total_bytes=v_tb where id=v_id;
 -- retencao: mantem so as p_keep copias mais recentes
 for r in select id from backup.snapshots order by id desc offset p_keep loop
  for v_t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='backup' and c.relkind='r' and c.relname like 's'||r.id||'\_\_%' loop
   execute format('drop table backup.%I',v_t);
  end loop;
  delete from backup.snapshots where id=r.id;
 end loop;
 return jsonb_build_object('snapshot_id',v_id,'rows',v_tr,'bytes',v_tb,'tables',v_tab);
end $fn$;
revoke all on function backup.take_snapshot_v1(int) from public,anon,authenticated;

-- Historico de alteracoes (somente colunas que mudaram; ignora mudancas so de updated_at).
create table if not exists public.commerce_audit_log_v1 (
 id bigint generated always as identity primary key,
 changed_at timestamptz not null default now(),
 table_name text not null,
 row_id text,
 action text not null check(action in ('INSERT','UPDATE','DELETE')),
 old_values jsonb,
 new_values jsonb
);
create index if not exists commerce_audit_log_v1_table_idx on public.commerce_audit_log_v1(table_name,row_id,changed_at desc);
create index if not exists commerce_audit_log_v1_time_idx on public.commerce_audit_log_v1(changed_at);
alter table public.commerce_audit_log_v1 enable row level security;
revoke all on public.commerce_audit_log_v1 from public,anon,authenticated;
grant select on public.commerce_audit_log_v1 to service_role;

create or replace function public.commerce_audit_trigger_v1()
returns trigger language plpgsql volatile security definer set search_path=pg_catalog,public
as $fn$
declare v_old jsonb; v_new jsonb; v_o jsonb:='{}'::jsonb; v_n jsonb:='{}'::jsonb; k text;
begin
 if tg_op='INSERT' then
   v_new:=to_jsonb(new);
   insert into public.commerce_audit_log_v1(table_name,row_id,action,new_values) values (tg_table_name,v_new->>'id','INSERT',v_new);
   return new;
 elsif tg_op='DELETE' then
   v_old:=to_jsonb(old);
   insert into public.commerce_audit_log_v1(table_name,row_id,action,old_values) values (tg_table_name,v_old->>'id','DELETE',v_old);
   return old;
 end if;
 v_old:=to_jsonb(old); v_new:=to_jsonb(new);
 for k in select key from jsonb_each(v_new) loop
  if k<>'updated_at' and (v_old->k) is distinct from (v_new->k) then
    v_o:=v_o||jsonb_build_object(k,v_old->k); v_n:=v_n||jsonb_build_object(k,v_new->k);
  end if;
 end loop;
 if v_n<>'{}'::jsonb then
   insert into public.commerce_audit_log_v1(table_name,row_id,action,old_values,new_values) values (tg_table_name,v_new->>'id','UPDATE',v_o,v_n);
 end if;
 return new;
end $fn$;
revoke all on function public.commerce_audit_trigger_v1() from public,anon,authenticated;

do $mig$
declare t text;
begin
 foreach t in array array['commerce_products','commerce_product_skus','commerce_listings','commerce_listing_products'] loop
  execute format('drop trigger if exists commerce_audit_v1 on public.%I',t);
  execute format('create trigger commerce_audit_v1 after insert or update or delete on public.%I for each row execute function public.commerce_audit_trigger_v1()',t);
 end loop;
end $mig$;

-- Limpeza: historico com mais de 180 dias sai sozinho (mantem o banco pequeno).
create or replace function backup.cleanup_audit_v1(p_days int default 180)
returns bigint language plpgsql volatile security definer set search_path=pg_catalog,public
as $fn$
declare n bigint;
begin
 if p_days is null or p_days<30 then raise exception 'Retencao minima de 30 dias.'; end if;
 delete from public.commerce_audit_log_v1 where changed_at<now()-make_interval(days=>p_days);
 get diagnostics n=row_count; return n;
end $fn$;
revoke all on function backup.cleanup_audit_v1(int) from public,anon,authenticated;

-- Resumo para a tela (somente leitura): copias existentes, tamanho do historico.
create or replace function public.commerce_protection_status_v1()
returns jsonb language sql stable security definer set search_path=pg_catalog,public,backup
as $fn$
select jsonb_build_object(
 'snapshots',coalesce((select jsonb_agg(jsonb_build_object('id',id,'taken_at',taken_at,'rows',total_rows,'bytes',total_bytes) order by id desc) from backup.snapshots),'[]'::jsonb),
 'audit',jsonb_build_object('rows',(select count(*) from public.commerce_audit_log_v1),
   'oldest',(select min(changed_at) from public.commerce_audit_log_v1),
   'bytes',pg_total_relation_size('public.commerce_audit_log_v1')),
 'database_bytes',pg_database_size(current_database()));
$fn$;
revoke all on function public.commerce_protection_status_v1() from public,anon,authenticated;
grant execute on function public.commerce_protection_status_v1() to service_role;

-- Agenda (domingo 06:00 UTC = 03:00 Brasilia): copia semanal; limpeza do historico no mesmo dia.
select cron.unschedule(jobid) from cron.job where jobname in ('nisti_backup_semanal','nisti_audit_limpeza');
select cron.schedule('nisti_backup_semanal','0 6 * * 0','select backup.take_snapshot_v1(4)');
select cron.schedule('nisti_audit_limpeza','30 6 * * 0','select backup.cleanup_audit_v1(180)');
