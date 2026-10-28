-- Vendas por semana (4 janelas de 7 dias) e por dia (14 dias) de cada anuncio. Somente leitura.
-- p_anchor='last_day' (padrao): termina no ultimo dia com venda importada (aba "Em queda").
-- p_anchor='last_sale': termina na ULTIMA VENDA de cada anuncio (aba "Pararam": como vendia antes de parar).
create or replace function public.commerce_listing_sales_breakdown_v2(p_listing_ids bigint[], p_anchor text default 'last_day')
returns jsonb language sql stable set search_path=public
as $fn$
with ref as (
  select max(sale_date) last_day from public.commerce_current_sales_listing_daily_v1
), ads as (
  select l.id listing_id,l.external_listing_id,
    case when m.code='MERCADO_LIVRE'
      then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
      else m.code end source_code
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where l.id=any(coalesce(p_listing_ids,'{}')) and cardinality(coalesce(p_listing_ids,'{}'))<=200
), ends as (
  select a.listing_id,a.external_listing_id,a.source_code,
    case when p_anchor='last_sale' then coalesce((
      select max(v.sale_date) from public.commerce_current_sales_listing_daily_v1 v
      where v.external_listing_id=a.external_listing_id and v.platform_code=a.source_code and v.units>0),r.last_day)
    else r.last_day end end_day
  from ads a cross join ref r
), d as (
  select e.listing_id,v.sale_date,sum(v.units) units,sum(v.product_revenue) revenue
  from ends e
  join public.commerce_current_sales_listing_daily_v1 v
    on v.external_listing_id=e.external_listing_id and v.platform_code=e.source_code
   and v.sale_date>e.end_day-28 and v.sale_date<=e.end_day
  group by e.listing_id,v.sale_date
), wk as (
  select e.listing_id,g.n,coalesce(sum(d.units),0) units,coalesce(sum(d.revenue),0) revenue
  from ends e cross join generate_series(0,3) g(n)
  left join d on d.listing_id=e.listing_id
   and d.sale_date>e.end_day-7*(g.n+1) and d.sale_date<=e.end_day-7*g.n
  group by e.listing_id,g.n
), dy as (
  select e.listing_id,g.n,coalesce(d.units,0) units
  from ends e cross join generate_series(0,13) g(n)
  left join d on d.listing_id=e.listing_id and d.sale_date=e.end_day-g.n
)
select coalesce(jsonb_object_agg(e.listing_id::text,jsonb_build_object(
  'last_day',e.end_day,
  'weeks',(select jsonb_agg(jsonb_build_object('start',e.end_day-7*w.n-6,'end',e.end_day-7*w.n,
      'units',w.units,'revenue',round(w.revenue,2)) order by w.n desc) from wk w where w.listing_id=e.listing_id),
  'days',(select jsonb_agg(jsonb_build_object('day',e.end_day-y.n,'units',y.units) order by y.n desc)
      from dy y where y.listing_id=e.listing_id)
)),'{}'::jsonb)
from ends e;
$fn$;
revoke all on function public.commerce_listing_sales_breakdown_v2(bigint[],text) from public,anon,authenticated;
grant execute on function public.commerce_listing_sales_breakdown_v2(bigint[],text) to service_role;
