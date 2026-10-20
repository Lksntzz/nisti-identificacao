-- Dados de tráfego lançados a partir de relatórios externos do marketplace.
-- Origem explícita e períodos exatos; nunca deduzir impressões, CTR ou conversão a partir de vendas.
create table if not exists public.commerce_listing_traffic_reports_v1 (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.commerce_listings(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  traffic_scope text not null check (traffic_scope in ('ALL','ORGANIC','PAID')),
  visits bigint check (visits is null or visits >= 0),
  impressions bigint check (impressions is null or impressions >= 0),
  clicks bigint check (clicks is null or clicks >= 0),
  orders bigint check (orders is null or orders >= 0),
  source_label text not null check (char_length(btrim(source_label)) between 8 and 200),
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  constraint commerce_listing_traffic_dates_check check (
    period_end >= period_start and period_end - period_start between 0 and 90
  ),
  constraint commerce_listing_traffic_metric_check check (
    visits is not null or impressions is not null or clicks is not null or orders is not null
  ),
  constraint commerce_listing_traffic_ctr_check check (
    clicks is null or impressions is null or clicks <= impressions
  ),
  unique (listing_id,traffic_scope,period_start,period_end)
);
create index if not exists commerce_listing_traffic_listing_period_idx
  on public.commerce_listing_traffic_reports_v1(listing_id,period_start,period_end);
alter table public.commerce_listing_traffic_reports_v1 enable row level security;
revoke all on public.commerce_listing_traffic_reports_v1 from public, anon, authenticated;
grant select,insert,update on public.commerce_listing_traffic_reports_v1 to service_role;
grant usage,select on sequence public.commerce_listing_traffic_reports_v1_id_seq to service_role;

create or replace function public.commerce_save_listing_traffic_v1(
  p_listing_id bigint,p_period_start date,p_period_end date,p_scope text,
  p_visits bigint,p_impressions bigint,p_clicks bigint,p_orders bigint,
  p_source_label text,p_actor text
) returns jsonb
language plpgsql volatile security invoker set search_path=public
as $function$
declare saved_id bigint;
begin
  if p_listing_id is null or not exists(
      select 1 from public.commerce_listings where id=p_listing_id
    ) then
    raise exception 'Anúncio não encontrado.';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start
     or p_period_end-p_period_start>90
     or p_period_end >= (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Período inválido ou ainda não concluído.';
  end if;
  if p_scope not in ('ALL','ORGANIC','PAID')
     or length(btrim(coalesce(p_source_label,''))) not between 8 and 200
     or p_actor is null or length(btrim(p_actor))=0
     or (p_visits is null and p_impressions is null and p_clicks is null and p_orders is null)
     or coalesce(p_visits,0)<0 or coalesce(p_impressions,0)<0
     or coalesce(p_clicks,0)<0 or coalesce(p_orders,0)<0
     or (p_clicks is not null and p_impressions is not null and p_clicks>p_impressions)
  then
    raise exception 'Dados de tráfego inválidos.';
  end if;
  insert into public.commerce_listing_traffic_reports_v1 (
    listing_id,period_start,period_end,traffic_scope,visits,impressions,
    clicks,orders,source_label,recorded_by
  ) values (
    p_listing_id,p_period_start,p_period_end,p_scope,p_visits,p_impressions,
    p_clicks,p_orders,btrim(p_source_label),left(btrim(p_actor),120)
  )
  on conflict(listing_id,traffic_scope,period_start,period_end)
  do update set visits=excluded.visits,impressions=excluded.impressions,
    clicks=excluded.clicks,orders=excluded.orders,source_label=excluded.source_label,
    recorded_by=excluded.recorded_by,recorded_at=now()
  returning id into saved_id;
  return jsonb_build_object('saved',true,'id',saved_id);
end;
$function$;

create or replace function public.commerce_listing_traffic_window_v1(
  p_listing_id bigint,p_period_start date,p_period_end date
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with bounds as (
  select p_period_start as current_start,p_period_end as current_end,
    p_period_start - (p_period_end-p_period_start+1) as previous_start,
    p_period_start - 1 as previous_end
), picked as (
  select r.traffic_scope,
    case when r.period_start=b.current_start and r.period_end=b.current_end
      then 'current' else 'previous' end as window,
    jsonb_build_object(
      'visits',r.visits,'impressions',r.impressions,'clicks',r.clicks,
      'orders',r.orders,'source',r.source_label,'recorded_at',r.recorded_at
    ) as data
  from public.commerce_listing_traffic_reports_v1 r
  cross join bounds b
  where r.listing_id=p_listing_id
    and ((r.period_start=b.current_start and r.period_end=b.current_end)
      or (r.period_start=b.previous_start and r.period_end=b.previous_end))
)
select jsonb_build_object(
 'period_start',b.current_start,'period_end',b.current_end,
 'previous_start',b.previous_start,'previous_end',b.previous_end,
 'current',coalesce((select jsonb_object_agg(p.traffic_scope,p.data) from picked p where p.window='current'),'{}'::jsonb),
 'previous',coalesce((select jsonb_object_agg(p.traffic_scope,p.data) from picked p where p.window='previous'),'{}'::jsonb)
)
from bounds b;
$function$;

revoke all on function public.commerce_save_listing_traffic_v1(
  bigint,date,date,text,bigint,bigint,bigint,bigint,text,text
) from public,anon,authenticated;
revoke all on function public.commerce_listing_traffic_window_v1(bigint,date,date)
  from public,anon,authenticated;
grant execute on function public.commerce_save_listing_traffic_v1(
  bigint,date,date,text,bigint,bigint,bigint,bigint,text,text
) to service_role;
grant execute on function public.commerce_listing_traffic_window_v1(bigint,date,date)
  to service_role;
