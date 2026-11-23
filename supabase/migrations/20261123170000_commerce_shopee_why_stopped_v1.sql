-- Leitura (somente leitura): painel "Por que parou" (Shopee). Anuncios ATIVOS que vendiam (5+ un em 7 dias ou 10+ em 14/30)
-- e cairam 30% ou mais (ou zeraram) nos ultimos p_days dias COMPLETOS contra os p_days anteriores.
-- Motivo provavel: compara o relatorio de desempenho mais recente com o anterior SEM sobreposicao (por dia):
-- impressoes/dia (VISIBILIDADE), CTR (CLIQUE) ou conversao pedidos/visitantes (CONVERSAO); a etapa que mais caiu (<= -20%).
-- Etapa so conta com volume minimo nos 2 relatorios: 1.000 impressoes (impressoes e CTR) e 100 visitantes (conversao).
-- Nenhuma caiu 20%: SEM_SINAL. Anuncio fora de um dos relatorios: SEM_RELATORIO. Preco = receita/unidades das vendas importadas.
create or replace function public.commerce_shopee_why_stopped_v1(p_days integer default 14)
returns jsonb language sql stable security invoker set search_path=public
as $fn$
with p as (select case when p_days in (7,14,30) then p_days else 14 end as d),
thru as (select (max(sale_date)-1) as d from public.commerce_current_sales_listing_daily_v1 where platform_code='SHOPEE'),
w as (select (select d from thru) as e,(select d from thru)-(select d from p) as m,(select d from thru)-2*(select d from p) as s),
sales as (
  select external_listing_id as ext,
    coalesce(sum(units) filter(where sale_date>(select m from w)),0) as u_cur,
    coalesce(sum(units) filter(where sale_date<=(select m from w)),0) as u_prev,
    coalesce(sum(product_revenue) filter(where sale_date>(select m from w)),0) as r_cur,
    coalesce(sum(product_revenue) filter(where sale_date<=(select m from w)),0) as r_prev
  from public.commerce_current_sales_listing_daily_v1
  where platform_code='SHOPEE' and sale_date>(select s from w) and sale_date<=(select e from w)
  group by 1
),
last_sale as (
  select external_listing_id as ext,max(sale_date) as ult from public.commerce_current_sales_listing_daily_v1
  where platform_code='SHOPEE' and units>0 group by 1
),
cand as (
  select l.id as listing_id,l.external_listing_id as ext,l.title,s.u_cur,s.u_prev,s.r_cur,s.r_prev,ls.ult
  from public.commerce_listings l
  join public.commerce_marketplaces mk on mk.id=l.marketplace_id and mk.code='SHOPEE'
  join sales s on s.ext=l.external_listing_id
  left join last_sale ls on ls.ext=l.external_listing_id
  where l.listing_status='ACTIVE'
    and s.u_prev>=case when (select d from p)=7 then 5 else 10 end
    and s.u_cur<=s.u_prev*0.7
),
rb as (select id,period_start,period_end,(period_end-period_start+1) as span from public.commerce_shopee_performance_reports_v1 order by period_end desc,id desc limit 1),
ra as (select id,period_start,period_end,(period_end-period_start+1) as span from public.commerce_shopee_performance_reports_v1
       where period_end<(select period_start from rb) order by period_end desc,id desc limit 1),
perf as (
  select c.ext,
    b.impressions::numeric/(select span from rb) as imp_b, a.impressions::numeric/nullif((select span from ra),0) as imp_a,
    case when b.impressions>0 then b.clicks::numeric/b.impressions end as ctr_b, case when a.impressions>0 then a.clicks::numeric/a.impressions end as ctr_a,
    case when b.visitors>0 then b.orders_placed::numeric/b.visitors end as conv_b, case when a.visitors>0 then a.orders_placed::numeric/a.visitors end as conv_a,
    case when b.visitors>0 then b.add_cart_visitors::numeric/b.visitors end as cart_b, case when a.visitors>0 then a.add_cart_visitors::numeric/a.visitors end as cart_a,
    b.visitors::numeric/(select span from rb) as vis_b, a.visitors::numeric/nullif((select span from ra),0) as vis_a,
    (b.external_item_id is not null) as has_b,(a.external_item_id is not null) as has_a,
    least(b.impressions,a.impressions) as min_imp,least(b.visitors,a.visitors) as min_vis
  from cand c
  left join public.commerce_shopee_performance_rows_v1 b on b.report_id=(select id from rb) and b.external_item_id=c.ext
  left join public.commerce_shopee_performance_rows_v1 a on a.report_id=(select id from ra) and a.external_item_id=c.ext
),
chg as (
  select ext,has_a,has_b,min_imp,min_vis,imp_a,imp_b,ctr_a,ctr_b,conv_a,conv_b,cart_a,cart_b,vis_a,vis_b,
    (coalesce(min_imp,0)<1000 or coalesce(min_vis,0)<100) as low_volume,
    case when imp_a>0 and min_imp>=1000 then (imp_b-imp_a)/imp_a*100 end as d_imp,
    case when ctr_a>0 and min_imp>=1000 then (ctr_b-ctr_a)/ctr_a*100 end as d_ctr,
    case when conv_a>0 and min_vis>=100 then (conv_b-conv_a)/conv_a*100 end as d_conv
  from perf
),
diag as (
  select *,
    case when not (has_a and has_b) then 'SEM_RELATORIO'
      when least(coalesce(d_imp,0),coalesce(d_ctr,0),coalesce(d_conv,0))>-20 then 'SEM_SINAL'
      when coalesce(d_imp,0)<=least(coalesce(d_ctr,0),coalesce(d_conv,0)) then 'VISIBILIDADE'
      when coalesce(d_ctr,0)<=coalesce(d_conv,0) then 'CLIQUE'
      else 'CONVERSAO' end as cause
  from chg
),
rows as (
  select c.*,d.cause,d.low_volume,d.d_imp,d.d_ctr,d.d_conv,d.imp_a,d.imp_b,d.ctr_a,d.ctr_b,d.conv_a,d.conv_b,d.cart_a,d.cart_b,d.vis_a,d.vis_b,
    case when c.u_prev>0 then c.r_prev/c.u_prev end as price_prev,
    case when c.u_cur>0 then c.r_cur/c.u_cur end as price_cur,
    case when c.u_cur=0 then 'PAROU' else 'QUEDA' end as kind
  from cand c join diag d on d.ext=c.ext
)
select jsonb_build_object(
  'days',(select d from p),
  'window',jsonb_build_object('prev_start',(select s from w)+1,'prev_end',(select m from w),'cur_start',(select m from w)+1,'cur_end',(select e from w)),
  'report_before',(select jsonb_build_object('id',id,'start',period_start,'end',period_end) from ra),
  'report_after',(select jsonb_build_object('id',id,'start',period_start,'end',period_end) from rb),
  'kpis',jsonb_build_object(
    'total',(select count(*) from rows),
    'stopped',(select count(*) from rows where kind='PAROU'),
    'falling',(select count(*) from rows where kind='QUEDA'),
    'lost_revenue',(select coalesce(sum(r_prev-r_cur),0) from rows),
    'lost_units',(select coalesce(sum(u_prev-u_cur),0) from rows),
    'visibility',(select count(*) from rows where cause='VISIBILIDADE'),
    'click',(select count(*) from rows where cause='CLIQUE'),
    'conversion',(select count(*) from rows where cause='CONVERSAO'),
    'no_signal',(select count(*) from rows where cause='SEM_SINAL'),
    'no_report',(select count(*) from rows where cause='SEM_RELATORIO'),
    'price_up',(select count(*) from rows where price_prev>0 and price_cur>=price_prev*1.1)),
  'items',coalesce((select jsonb_agg(jsonb_build_object(
    'item_id',ext,'listing_id',listing_id,'title',title,'kind',kind,'cause',cause,
    'units_prev',u_prev,'units_cur',u_cur,'revenue_prev',r_prev,'revenue_cur',r_cur,'last_sale',ult,
    'drop_pct',round((u_prev-u_cur)::numeric/u_prev*100,1),
    'price_prev',round(price_prev,2),'price_cur',round(price_cur,2),
    'imp_day_before',round(imp_a),'imp_day_after',round(imp_b),'imp_change',round(d_imp,1),
    'ctr_before',round(ctr_a*100,2),'ctr_after',round(ctr_b*100,2),'ctr_change',round(d_ctr,1),
    'conv_before',round(conv_a*100,2),'conv_after',round(conv_b*100,2),'conv_change',round(d_conv,1),
    'low_volume',low_volume,'cart_before',round(cart_a*100,2),'cart_after',round(cart_b*100,2),
    'vis_day_before',round(vis_a,1),'vis_day_after',round(vis_b,1))
    order by (r_prev-r_cur) desc,ext) from rows),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_shopee_why_stopped_v1(integer) from public,anon,authenticated;
grant execute on function public.commerce_shopee_why_stopped_v1(integer) to service_role;
