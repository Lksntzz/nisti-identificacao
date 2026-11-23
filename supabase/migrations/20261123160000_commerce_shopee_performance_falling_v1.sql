-- Leitura (somente leitura): anuncios ATIVOS da Shopee com boa performance no relatorio importado (vendeu bem OU muito trafego,
-- normalizado para 30 dias) que continuam vendendo, mas vendem 30% ou mais menos que no periodo anterior de mesma duracao.
-- Janela: os ultimos p_days dias completos x os p_days anteriores (o ultimo dia com dados fica de fora por ser parcial).
-- Volume minimo no periodo anterior: 5 unidades (7 dias) ou 10 (14 e 30 dias). Quem zerou aparece em "Bons que pararam".
create or replace function public.commerce_shopee_performance_falling_v1(p_report_id bigint default null,p_days integer default 14)
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with p as (select case when p_days in (7,14,30) then p_days else 14 end as d),
sel as (
  select id,period_start,period_end,(period_end-period_start+1) as span from public.commerce_shopee_performance_reports_v1
  where id=coalesce(p_report_id,(select id from public.commerce_shopee_performance_reports_v1 order by period_end desc,id desc limit 1))
),
-- dia parcial (o ultimo com dados) fica de fora: a janela termina no dia anterior
thru as (select (max(sale_date)-1) as d from public.commerce_current_sales_listing_daily_v1 where platform_code='SHOPEE'),
sales as (
  select external_listing_id as ext,
    sum(units) filter(where sale_date>(select d from thru)-(select d from p) and sale_date<=(select d from thru)) as u_cur,
    sum(units) filter(where sale_date>(select d from thru)-2*(select d from p) and sale_date<=(select d from thru)-(select d from p)) as u_prev,
    sum(product_revenue) filter(where sale_date>(select d from thru)-(select d from p) and sale_date<=(select d from thru)) as r_cur,
    sum(product_revenue) filter(where sale_date>(select d from thru)-2*(select d from p) and sale_date<=(select d from thru)-(select d from p)) as r_prev
  from public.commerce_current_sales_listing_daily_v1
  where platform_code='SHOPEE' and sale_date>(select d from thru)-2*(select d from p) and sale_date<=(select d from thru)
  group by 1
),
base as (
  select r.external_item_id,l.title,r.impressions,r.visitors,r.add_cart_visitors,r.orders_placed,
    coalesce(s.u_cur,0) as u_cur,coalesce(s.u_prev,0) as u_prev,coalesce(s.r_cur,0) as r_cur,coalesce(s.r_prev,0) as r_prev,
    r.orders_placed::numeric*30/(select span from sel) as orders30,
    r.visitors::numeric*30/(select span from sel) as visitors30
  from public.commerce_shopee_performance_rows_v1 r
  join public.commerce_listings l on l.id=r.listing_id and l.listing_status='ACTIVE'
  left join sales s on s.ext=r.external_item_id
  where r.report_id=(select id from sel)
),
hit as (
  select *,(orders30>=20) as good_sales,(visitors30>=300) as good_traffic,
    round((u_prev-u_cur)::numeric/u_prev*100,1) as drop_pct
  from base
  where (orders30>=20 or visitors30>=300)
    and u_prev>=case when (select d from p)=7 then 5 else 10 end
    and u_cur>0 and u_cur<=u_prev*0.7
)
select jsonb_build_object(
  'reports',coalesce((select jsonb_agg(jsonb_build_object('id',id,'filename',filename,'start',period_start,'end',period_end,'rows',row_count)
      order by period_end desc,id desc) from public.commerce_shopee_performance_reports_v1),'[]'::jsonb),
  'selected_id',(select id from sel),
  'days',(select d from p),
  'window_end',(select d from thru),
  'min_prev',case when (select d from p)=7 then 5 else 10 end,
  'active_items',(select count(*) from base),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
      'item_id',external_item_id,'title',title,'visitors',visitors,'add_cart',add_cart_visitors,'orders',orders_placed,
      'units_cur',u_cur,'units_prev',u_prev,'revenue_cur',r_cur,'revenue_prev',r_prev,'drop_pct',drop_pct,'lost_units',u_prev-u_cur,
      'good_sales',good_sales,'good_traffic',good_traffic)
      order by (u_prev-u_cur) desc,external_item_id) from hit),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_shopee_performance_falling_v1(bigint,integer) from public,anon,authenticated;
grant execute on function public.commerce_shopee_performance_falling_v1(bigint,integer) to service_role;
