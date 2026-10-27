-- Leitura (somente leitura): relatorio de desempenho mais recente da Shopee (um unico periodo), por anuncio, para o Dashboard.
-- Conversao = pedidos feitos / visitantes do produto (pedidos feitos incluem cancelados depois). Dados isolados.
create or replace function public.commerce_shopee_performance_latest_v1()
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with last as (
  select distinct on (r.external_item_id) r.external_item_id,r.visitors,r.impressions,r.clicks,r.orders_placed,r.units_placed,
    rp.period_start,rp.period_end
  from public.commerce_shopee_performance_rows_v1 r
  join public.commerce_shopee_performance_reports_v1 rp on rp.id=r.report_id
  where rp.id=(select id from public.commerce_shopee_performance_reports_v1 order by period_end desc,id desc limit 1)
  order by r.external_item_id,rp.period_end desc,rp.id desc
)
select jsonb_build_object(
  'reports',coalesce((select jsonb_agg(jsonb_build_object('start',period_start,'end',period_end) order by period_end desc)
      from (select distinct period_start,period_end from last) d),'[]'::jsonb),
  'items',coalesce((select jsonb_object_agg(external_item_id,jsonb_build_object(
      'visits',visitors,'impressions',impressions,'clicks',clicks,'orders',orders_placed,'units',units_placed,
      'conversion_pct',case when visitors>0 then round(orders_placed::numeric/visitors*100,2) end,
      'start',period_start,'end',period_end)) from last),'{}'::jsonb));
$fn$;
revoke all on function public.commerce_shopee_performance_latest_v1() from public,anon,authenticated;
grant execute on function public.commerce_shopee_performance_latest_v1() to service_role;
