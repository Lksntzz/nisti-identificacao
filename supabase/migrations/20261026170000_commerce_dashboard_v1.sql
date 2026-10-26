-- Somente leitura. Dashboard comercial: curva ABC por SKU, maiores quedas e top 15 anuncios.
-- Base: commerce_current_sales_listing_daily_v1 (vendas importadas) + commerce_listings (titulo/status).
-- Janela atual = ultimos p_days dias com venda importada; janela anterior = mesmo tamanho imediatamente antes.
create or replace function public.commerce_dashboard_v1(
  p_platform text default 'TODAS', p_days integer default 30
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_days in (7,30,60,90) then p_days else 30 end days
), base as (
  select v.* from public.commerce_current_sales_listing_daily_v1 v, params p
  where p.plat='TODAS' or v.platform_code=p.plat
), ref as (
  select max(sale_date) last_day,min(sale_date) first_day from base
), win as (
  select b.platform_code,b.external_listing_id,
    max(nullif(btrim(b.sku_norm),'')) sku,
    coalesce(sum(b.units) filter (where b.sale_date>r.last_day-p.days),0) cur_units,
    coalesce(sum(b.product_revenue) filter (where b.sale_date>r.last_day-p.days),0) cur_rev,
    coalesce(sum(b.units) filter (where b.sale_date<=r.last_day-p.days and b.sale_date>r.last_day-2*p.days),0) prev_units,
    coalesce(sum(b.product_revenue) filter (where b.sale_date<=r.last_day-p.days and b.sale_date>r.last_day-2*p.days),0) prev_rev
  from base b cross join params p cross join ref r
  where b.sale_date>r.last_day-2*p.days
  group by b.platform_code,b.external_listing_id
), lst as (
  select w.*,l.id listing_id,l.title,l.listing_status
  from win w
  left join lateral (
    select l.id,l.title,l.listing_status from public.commerce_listings l
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where l.external_listing_id=w.external_listing_id
      and (case when m.code='MERCADO_LIVRE' then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end)=w.platform_code
    order by (l.listing_status='ACTIVE') desc,l.id limit 1
  ) l on true
), prod as (
  select coalesce(sku,'ANÚNCIO '||external_listing_id) product_key,
    sum(cur_units) units,sum(cur_rev) revenue,
    (array_agg(title order by cur_rev desc))[1] title,
    count(*) filter (where cur_units>0) listings
  from lst where cur_rev>0 group by 1
), ranked as (
  select p.*,sum(revenue) over (order by revenue desc,product_key rows between unbounded preceding and 1 preceding) before_rev,
    sum(revenue) over () total_rev from prod p
), abc as (
  select r.*,case when coalesce(before_rev,0)<0.80*total_rev then 'A' when coalesce(before_rev,0)<0.95*total_rev then 'B' else 'C' end cls
  from ranked r
), cls as (
  select cls,count(*) products,sum(units) units,sum(revenue) revenue from abc group by cls
), tot as (
  select coalesce(sum(cur_units),0) cur_units,coalesce(sum(cur_rev),0) cur_rev,
         coalesce(sum(prev_units),0) prev_units,coalesce(sum(prev_rev),0) prev_rev,
         count(*) filter (where cur_units>0) listings_selling
  from lst
), top as (
  select * from lst where cur_units>0 order by cur_rev desc,external_listing_id limit 15
), drops as (
  select * from lst
  where listing_status='ACTIVE' and prev_units>=5 and cur_units<prev_units
    and (cur_units-prev_units)::numeric/prev_units<=-0.15
), drops_top as (
  select * from drops order by (prev_rev-cur_rev) desc limit 20
)
select jsonb_build_object(
  'platform',(select plat from params),'days',(select days from params),
  'last_day',(select last_day from ref),'first_day',(select first_day from ref),
  'current_start',(select last_day-days+1 from ref,params),
  'previous_start',(select last_day-2*days+1 from ref,params),
  'previous_complete',(select first_day<=last_day-2*days+1 from ref,params),
  'totals',(select to_jsonb(t) from tot t),
  'abc',jsonb_build_object(
    'classes',coalesce((select jsonb_agg(jsonb_build_object('class',cls,'products',products,'units',units,'revenue',round(revenue,2),
        'revenue_pct',round(revenue/nullif((select sum(revenue) from cls),0)*100,1)) order by cls) from cls),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(jsonb_build_object('key',product_key,'class',cls,'title',title,'units',units,
        'revenue',round(revenue,2),'listings',listings,'cum_pct',round((coalesce(before_rev,0)+revenue)/total_rev*100,1))
        order by revenue desc,product_key) from (select * from abc order by revenue desc,product_key limit 120) x),'[]'::jsonb)),
  'top',coalesce((select jsonb_agg(jsonb_build_object('listing_id',listing_id,'platform',platform_code,'external_id',external_listing_id,
      'title',title,'status',listing_status,'sku',sku,'units',cur_units,'revenue',round(cur_rev,2),'units_previous',prev_units,
      'revenue_previous',round(prev_rev,2),'price',round(cur_rev/nullif(cur_units,0),2)) order by cur_rev desc,external_listing_id) from top),'[]'::jsonb),
  'drops',jsonb_build_object(
    'total',(select count(*) from drops),
    'lost_revenue',(select round(coalesce(sum(prev_rev-cur_rev),0),2) from drops),
    'items',coalesce((select jsonb_agg(jsonb_build_object('listing_id',listing_id,'platform',platform_code,'external_id',external_listing_id,
        'title',title,'sku',sku,'units',cur_units,'units_previous',prev_units,'revenue',round(cur_rev,2),'revenue_previous',round(prev_rev,2),
        'lost_revenue',round(prev_rev-cur_rev,2)) order by (prev_rev-cur_rev) desc) from drops_top),'[]'::jsonb))
);
$function$;
revoke all on function public.commerce_dashboard_v1(text,integer) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_v1(text,integer) to service_role;
