-- Vendas por semana (4 janelas de 7 dias) e por dia (ultimos 14 dias) de cada anuncio, terminando no
-- ultimo dia com venda importada. Somente leitura; substitui a coluna "Por que caiu" da aba "Em queda".
create or replace function public.commerce_listing_sales_breakdown_v1(p_listing_ids bigint[])
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
), d as (
  select a.listing_id,v.sale_date,sum(v.units) units,sum(v.product_revenue) revenue
  from ads a cross join ref r
  join public.commerce_current_sales_listing_daily_v1 v
    on v.external_listing_id=a.external_listing_id and v.platform_code=a.source_code
   and v.sale_date>r.last_day-28
  group by a.listing_id,v.sale_date
), wk as (
  select a.listing_id,g.n,coalesce(sum(d.units),0) units,coalesce(sum(d.revenue),0) revenue
  from ads a cross join ref r cross join generate_series(0,3) g(n)
  left join d on d.listing_id=a.listing_id
   and d.sale_date>r.last_day-7*(g.n+1) and d.sale_date<=r.last_day-7*g.n
  group by a.listing_id,g.n
), dy as (
  select a.listing_id,g.n,coalesce(d.units,0) units
  from ads a cross join ref r cross join generate_series(0,13) g(n)
  left join d on d.listing_id=a.listing_id and d.sale_date=r.last_day-g.n
)
select coalesce(jsonb_object_agg(a.listing_id::text,jsonb_build_object(
  'last_day',r.last_day,
  'weeks',(select jsonb_agg(jsonb_build_object('start',r.last_day-7*w.n-6,'end',r.last_day-7*w.n,
      'units',w.units,'revenue',round(w.revenue,2)) order by w.n desc) from wk w where w.listing_id=a.listing_id),
  'days',(select jsonb_agg(jsonb_build_object('day',r.last_day-y.n,'units',y.units) order by y.n desc)
      from dy y where y.listing_id=a.listing_id)
)),'{}'::jsonb)
from ads a cross join ref r;
$fn$;
revoke all on function public.commerce_listing_sales_breakdown_v1(bigint[]) from public,anon,authenticated;
grant execute on function public.commerce_listing_sales_breakdown_v1(bigint[]) to service_role;
