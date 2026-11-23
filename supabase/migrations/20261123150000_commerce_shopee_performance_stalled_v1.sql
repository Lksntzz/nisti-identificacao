-- Leitura (somente leitura): anuncios ATIVOS da Shopee que tinham boa performance no relatorio importado
-- (vendeu bem OU muito trafego, normalizado para 30 dias) e estao sem vender ha p_days dias ou mais.
-- Ultima venda vem de commerce_current_sales_listing_daily_v1; "dias sem vender" conta a partir do ultimo dia com dados da Shopee.
create or replace function public.commerce_shopee_performance_stalled_v1(p_report_id bigint default null,p_days integer default 7)
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with p as (select case when p_days in (3,7,14,30) then p_days else 7 end as d),
sel as (
  select id,period_start,period_end,(period_end-period_start+1) as span from public.commerce_shopee_performance_reports_v1
  where id=coalesce(p_report_id,(select id from public.commerce_shopee_performance_reports_v1 order by period_end desc,id desc limit 1))
),
thru as (select max(sale_date) as d from public.commerce_current_sales_listing_daily_v1 where platform_code='SHOPEE'),
last_sale as (
  select external_listing_id as ext,max(sale_date) as ult from public.commerce_current_sales_listing_daily_v1
  where platform_code='SHOPEE' and units>0 group by 1
),
base as (
  select r.external_item_id,l.title,r.impressions,r.clicks,r.visitors,r.add_cart_visitors,r.orders_placed,r.revenue_paid,
    ls.ult,(select d from thru)-ls.ult as days_since,
    r.orders_placed::numeric*30/(select span from sel) as orders30,
    r.visitors::numeric*30/(select span from sel) as visitors30
  from public.commerce_shopee_performance_rows_v1 r
  join public.commerce_listings l on l.id=r.listing_id and l.listing_status='ACTIVE'
  left join last_sale ls on ls.ext=r.external_item_id
  where r.report_id=(select id from sel)
),
hit as (
  select *,(orders30>=20) as good_sales,(visitors30>=300) as good_traffic from base
  where (orders30>=20 or visitors30>=300) and (ult is null or days_since>=(select d from p))
)
select jsonb_build_object(
  'reports',coalesce((select jsonb_agg(jsonb_build_object('id',id,'filename',filename,'start',period_start,'end',period_end,'rows',row_count)
      order by period_end desc,id desc) from public.commerce_shopee_performance_reports_v1),'[]'::jsonb),
  'selected_id',(select id from sel),
  'data_through',(select d from thru),
  'days',(select d from p),
  'thresholds',jsonb_build_object('orders30',20,'visitors30',300,'span',(select span from sel)),
  'active_items',(select count(*) from base),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
      'item_id',external_item_id,'title',title,'impressions',impressions,'clicks',clicks,'visitors',visitors,'add_cart',add_cart_visitors,
      'orders',orders_placed,'revenue_paid',revenue_paid,'last_sale',ult,'days_since',days_since,
      'good_sales',good_sales,'good_traffic',good_traffic)
      order by good_sales desc,orders_placed desc,visitors desc,external_item_id) from hit),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_shopee_performance_stalled_v1(bigint,integer) from public,anon,authenticated;
grant execute on function public.commerce_shopee_performance_stalled_v1(bigint,integer) to service_role;
