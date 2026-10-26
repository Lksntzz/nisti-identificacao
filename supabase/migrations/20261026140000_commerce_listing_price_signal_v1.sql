-- Somente leitura. Compara a janela atual com a anterior (mesmo tamanho) por anuncio:
-- unidades, faturamento, preco medio realizado (faturamento/unidades) e um sinal explicavel.
-- O sinal e CORRELACAO observada nas vendas importadas; nao prova causa.
create or replace function public.commerce_listing_price_signal_v1(
  p_listing_ids bigint[], p_days integer default 30
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when p_days in (7,30,60,90) then p_days else 30 end days
), ads as (
  select l.id listing_id,l.external_listing_id,
    case when m.code='MERCADO_LIVRE'
      then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
      else m.code end source_code
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where l.id=any(coalesce(p_listing_ids,'{}')) and cardinality(coalesce(p_listing_ids,'{}'))<=200
), ref as (
  select max(sale_date) last_day from public.commerce_current_sales_listing_daily_v1
), win as (
  select a.listing_id,
    sum(v.units) filter (where v.sale_date>r.last_day-p.days) cur_units,
    sum(v.product_revenue) filter (where v.sale_date>r.last_day-p.days) cur_rev,
    sum(v.units) filter (where v.sale_date<=r.last_day-p.days and v.sale_date>r.last_day-2*p.days) prev_units,
    sum(v.product_revenue) filter (where v.sale_date<=r.last_day-p.days and v.sale_date>r.last_day-2*p.days) prev_rev
  from ads a cross join params p cross join ref r
  left join public.commerce_current_sales_listing_daily_v1 v
    on v.external_listing_id=a.external_listing_id and v.platform_code=a.source_code
   and v.sale_date>r.last_day-2*p.days
  group by a.listing_id
), calc as (
  select w.listing_id,
    coalesce(w.cur_units,0) cur_units,coalesce(w.prev_units,0) prev_units,
    round(coalesce(w.cur_rev,0),2) cur_rev,round(coalesce(w.prev_rev,0),2) prev_rev,
    round(w.cur_rev/nullif(w.cur_units,0),2) cur_price,
    round(w.prev_rev/nullif(w.prev_units,0),2) prev_price
  from win w
), sig as (
  select c.*,
    round((c.cur_price-c.prev_price)/nullif(c.prev_price,0)*100,1) price_pct,
    round((c.cur_units-c.prev_units)::numeric/nullif(c.prev_units,0)*100,1) units_pct
  from calc c
)
select coalesce(jsonb_object_agg(s.listing_id::text,jsonb_build_object(
  'units_current',s.cur_units,'units_previous',s.prev_units,
  'revenue_current',s.cur_rev,'revenue_previous',s.prev_rev,
  'price_current',s.cur_price,'price_previous',s.prev_price,
  'price_change_pct',s.price_pct,'units_change_pct',s.units_pct,
  'signal',case
    when s.cur_units+s.prev_units<10 or s.prev_units<5 then 'INSUFFICIENT'
    when s.price_pct>=5 and s.units_pct<=-15 then 'PRICE_UP_SALES_DOWN'
    when s.price_pct<=-5 and s.units_pct>=15 then 'PRICE_DOWN_SALES_UP'
    when abs(coalesce(s.price_pct,0))<5 and s.units_pct<=-15 then 'DROP_PRICE_STABLE'
    when abs(coalesce(s.price_pct,0))<5 and s.units_pct>=15 then 'RISE_PRICE_STABLE'
    when abs(coalesce(s.price_pct,0))>=5 then 'PRICE_CHANGED_SALES_FLAT'
    else 'STABLE' end
)),'{}'::jsonb)
from sig s;
$function$;
revoke all on function public.commerce_listing_price_signal_v1(bigint[],integer) from public,anon,authenticated;
grant execute on function public.commerce_listing_price_signal_v1(bigint[],integer) to service_role;
