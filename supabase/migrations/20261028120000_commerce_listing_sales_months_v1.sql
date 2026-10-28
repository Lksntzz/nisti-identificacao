-- Vendas mes a mes de cada anuncio (todo o historico importado): unidades, faturamento, dias com venda
-- e MELHOR DIA de cada mes. Com p_include_daily=true devolve tambem todos os dias (usar para 1 anuncio).
-- Somente leitura. Alimenta o selo "Mes mais vendido" e a comparacao entre meses no GA.
create or replace function public.commerce_listing_sales_months_v1(p_listing_ids bigint[], p_include_daily boolean default false)
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
  from ads a
  join public.commerce_current_sales_listing_daily_v1 v
    on v.external_listing_id=a.external_listing_id and v.platform_code=a.source_code
  group by a.listing_id,v.sale_date
), m as (
  select listing_id,to_char(sale_date,'YYYY-MM') ym,sum(units) units,round(sum(revenue),2) revenue,
    count(*) filter (where units>0) active_days
  from d group by listing_id,to_char(sale_date,'YYYY-MM')
), best as (
  select distinct on (listing_id,to_char(sale_date,'YYYY-MM'))
    listing_id,to_char(sale_date,'YYYY-MM') ym,sale_date best_day,units best_units
  from d order by listing_id,to_char(sale_date,'YYYY-MM'),units desc,sale_date desc
)
select coalesce(jsonb_object_agg(a.listing_id::text,jsonb_build_object(
  'last_day',r.last_day,
  'months',(select coalesce(jsonb_agg(jsonb_build_object('month',m.ym,'units',m.units,'revenue',m.revenue,
      'active_days',m.active_days,'best_day',b.best_day,'best_units',b.best_units) order by m.ym),'[]'::jsonb)
    from m join best b on b.listing_id=m.listing_id and b.ym=m.ym where m.listing_id=a.listing_id),
  'daily',case when p_include_daily then (select coalesce(jsonb_agg(jsonb_build_object('day',d.sale_date,'units',d.units) order by d.sale_date),'[]'::jsonb)
    from d where d.listing_id=a.listing_id) else null end
)),'{}'::jsonb)
from ads a cross join ref r;
$fn$;
revoke all on function public.commerce_listing_sales_months_v1(bigint[],boolean) from public,anon,authenticated;
grant execute on function public.commerce_listing_sales_months_v1(bigint[],boolean) to service_role;
