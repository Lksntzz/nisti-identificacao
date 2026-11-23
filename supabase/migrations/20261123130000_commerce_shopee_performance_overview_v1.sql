-- Leitura (somente leitura): tela "Desempenho Shopee" do GA. Funil por anuncio de UM relatorio importado
-- (impressoes, cliques, visitantes, carrinho, pedidos) e, opcionalmente, de um segundo relatorio para comparar.
-- Dados isolados: nao altera vendas, pedidos nem SKUs.
create or replace function public.commerce_shopee_performance_overview_v1(p_report_id bigint default null,p_compare_id bigint default null)
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with reps as (
  select id,filename,period_start,period_end,row_count from public.commerce_shopee_performance_reports_v1
),
sel as (
  select id from reps where id=coalesce(p_report_id,(select id from reps order by period_end desc,id desc limit 1))
),
cmp as (
  select id from reps where p_compare_id is not null and id=p_compare_id and id<>(select id from sel)
),
cur as (
  select r.external_item_id,r.listing_id,r.product_name,r.impressions,r.clicks,r.visitors,r.page_views,
    r.add_cart_visitors,r.orders_placed,r.units_placed,r.buyers_placed,r.revenue_placed,r.revenue_paid
  from public.commerce_shopee_performance_rows_v1 r where r.report_id=(select id from sel)
),
prv as (
  select r.external_item_id,r.impressions,r.clicks,r.visitors,r.add_cart_visitors,r.orders_placed,r.revenue_paid
  from public.commerce_shopee_performance_rows_v1 r where r.report_id=(select id from cmp)
)
select jsonb_build_object(
  'reports',coalesce((select jsonb_agg(jsonb_build_object('id',id,'filename',filename,'start',period_start,'end',period_end,'rows',row_count)
      order by period_end desc,id desc) from reps),'[]'::jsonb),
  'selected_id',(select id from sel),
  'compare_id',(select id from cmp),
  'totals',(select jsonb_build_object('items',count(*),'impressions',coalesce(sum(impressions),0),'clicks',coalesce(sum(clicks),0),
      'visitors',coalesce(sum(visitors),0),'page_views',coalesce(sum(page_views),0),'add_cart',coalesce(sum(add_cart_visitors),0),
      'orders',coalesce(sum(orders_placed),0),'units',coalesce(sum(units_placed),0),'buyers',coalesce(sum(buyers_placed),0),
      'revenue_placed',coalesce(sum(revenue_placed),0),'revenue_paid',coalesce(sum(revenue_paid),0)) from cur),
  'compare_totals',(select case when exists(select 1 from cmp) then (select jsonb_build_object('items',count(*),'impressions',coalesce(sum(impressions),0),
      'clicks',coalesce(sum(clicks),0),'visitors',coalesce(sum(visitors),0),'add_cart',coalesce(sum(add_cart_visitors),0),
      'orders',coalesce(sum(orders_placed),0),'revenue_paid',coalesce(sum(revenue_paid),0)) from prv) end),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
      'item_id',c.external_item_id,'listing_id',c.listing_id,'title',coalesce(l.title,c.product_name),'status',l.listing_status,
      'impressions',c.impressions,'clicks',c.clicks,'visitors',c.visitors,'page_views',c.page_views,'add_cart',c.add_cart_visitors,
      'orders',c.orders_placed,'units',c.units_placed,'buyers',c.buyers_placed,'revenue_placed',c.revenue_placed,'revenue_paid',c.revenue_paid,
      'prev',case when p.external_item_id is not null then jsonb_build_object('impressions',p.impressions,'clicks',p.clicks,'visitors',p.visitors,
         'add_cart',p.add_cart_visitors,'orders',p.orders_placed,'revenue_paid',p.revenue_paid) end)
      order by coalesce(c.revenue_paid,0) desc,c.external_item_id)
    from cur c left join public.commerce_listings l on l.id=c.listing_id left join prv p on p.external_item_id=c.external_item_id),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_shopee_performance_overview_v1(bigint,bigint) from public,anon,authenticated;
grant execute on function public.commerce_shopee_performance_overview_v1(bigint,bigint) to service_role;
