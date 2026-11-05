-- Cache de leitura no banco: guarda o resultado pronto de consultas pesadas do Dashboard/Categorias.
-- Não muda nenhuma conta: chama a MESMA função de sempre e só guarda o retorno.
-- Vale enquanto (a) nenhuma importação nova foi confirmada, (b) é o mesmo dia e (c) tem menos de 6 horas.
create table if not exists public.commerce_read_cache_v1(
  cache_key text primary key,
  data_version text not null,
  payload jsonb not null,
  computed_at timestamptz not null default now(),
  compute_ms integer
);
alter table public.commerce_read_cache_v1 enable row level security;
revoke all on public.commerce_read_cache_v1 from public,anon,authenticated;

create or replace function public.commerce_data_version_v1() returns text
language sql stable security invoker set search_path to 'public'
as $$
  select md5(
    coalesce((select max(committed_at)::text||':'||count(*) from public.commerce_sales_import_batches where status='COMMITTED'),'')
    ||'|'||(now() at time zone 'America/Sao_Paulo')::date::text
    ||'|'||(select count(*) from public.commerce_sku_alias_v1)
  );
$$;

create or replace function public.commerce_cached_read_v1(p_fn text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path to 'public'
as $fn$
declare
  allowed text[] := array['commerce_dashboard_abc_v2','commerce_dashboard_v1','commerce_dashboard_overview_v1',
    'commerce_dashboard_series_v2','commerce_dashboard_monthly_v1','commerce_dashboard_shipping_split_v1',
    'commerce_categories_timeline_v1','commerce_categories_v2'];
  k text; v text; hit record; t timestamptz; res jsonb; arglist text;
begin
  if not (p_fn = any(allowed)) then raise exception 'funcao_nao_permitida'; end if;
  select string_agg(format('%I => %L',e.key,e.value),', ' order by e.key) into arglist
    from jsonb_each_text(coalesce(p_args,'{}'::jsonb)) e;
  k := p_fn||'|'||coalesce((select jsonb_object_agg(e.key,e.value order by e.key)::text from jsonb_each_text(coalesce(p_args,'{}'::jsonb)) e),'{}');
  v := public.commerce_data_version_v1();
  select * into hit from public.commerce_read_cache_v1 where cache_key=k;
  if found and hit.data_version=v and hit.computed_at > now()-interval '6 hours' then
    return hit.payload;
  end if;
  t := clock_timestamp();
  execute format('select to_jsonb(public.%I(%s))',p_fn,coalesce(arglist,'')) into res;
  if res is not null then
    insert into public.commerce_read_cache_v1(cache_key,data_version,payload,computed_at,compute_ms)
    values (k,v,res,now(),round(extract(milliseconds from clock_timestamp()-t))::int)
    on conflict (cache_key) do update set data_version=excluded.data_version,payload=excluded.payload,
      computed_at=excluded.computed_at,compute_ms=excluded.compute_ms;
  end if;
  return res;
end;
$fn$;
revoke all on function public.commerce_data_version_v1() from public,anon,authenticated;
revoke all on function public.commerce_cached_read_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.commerce_data_version_v1() to service_role;
grant execute on function public.commerce_cached_read_v1(text,jsonb) to service_role;
