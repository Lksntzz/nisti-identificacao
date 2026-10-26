-- Somente leitura. Vendas por dia de um grupo de anuncios (queda, pararam, melhores, classe ABC), com o dia equivalente do periodo anterior.
-- Mesmas definicoes de commerce_dashboard_v1: janela atual = ultimos p_days dias com venda importada; anterior = mesmo tamanho antes.
create or replace function public.commerce_dashboard_segment_series_v1(
  p_platform text default 'TODAS', p_days integer default 30, p_segment text default 'drops'
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_days in (7,30,60,90) then p_days else 30 end days,
         case when lower(coalesce(p_segment,'')) in ('drops','stopped','best') then lower(p_segment)
              when upper(coalesce(p_segment,'')) in ('A','B','C') then upper(p_segment) else 'drops' end seg
), base as (
  select v.* from public.commerce_current_sales_listing_daily_v1 v, params p
  where p.plat='TODAS' or v.platform_code=p.plat
), ref as (select max(sale_date) last_day from base),
win as (
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
  select coalesce(sku,'ANÚNCIO '||external_listing_id) product_key,sum(cur_rev) revenue
  from lst where cur_rev>0 group by 1
), ranked as (
  select p.*,sum(revenue) over (order by revenue desc,product_key rows between unbounded preceding and 1 preceding) before_rev,
    sum(revenue) over () total_rev from prod p
), abc as (
  select r.product_key,case when coalesce(before_rev,0)<0.80*total_rev then 'A' when coalesce(before_rev,0)<0.95*total_rev then 'B' else 'C' end cls
  from ranked r
), picked as (
  select l.platform_code,l.external_listing_id from lst l,params p
  where (p.seg='drops' and l.listing_status='ACTIVE' and l.prev_units>=5 and l.cur_units<l.prev_units
          and (l.cur_units-l.prev_units)::numeric/l.prev_units<=-0.15)
     or (p.seg='stopped' and l.listing_status='ACTIVE' and l.cur_units=0 and l.prev_units>=3)
     or (p.seg in ('A','B','C') and l.cur_rev>0 and exists(select 1 from abc a where a.product_key=coalesce(l.sku,'ANÚNCIO '||l.external_listing_id) and a.cls=p.seg))
  union all
  select t.platform_code,t.external_listing_id from (
    select platform_code,external_listing_id from lst where cur_units>0 order by cur_rev desc,external_listing_id limit 15) t, params p
  where p.seg='best'
), sb as (
  select b.* from base b join picked k on k.platform_code=b.platform_code and k.external_listing_id=b.external_listing_id
), days as (
  select g.i,(r.last_day-p.days+1+g.i) cur_day,(r.last_day-p.days+1+g.i-p.days) prev_day
  from ref r cross join params p cross join lateral generate_series(0,p.days-1) g(i)
), agg as (
  select d.i,d.cur_day,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code='SHOPEE'),0) cur_shopee,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.cur_day and b.platform_code<>'SHOPEE'),0) cur_ml,
    coalesce(sum(b.units) filter (where b.sale_date=d.cur_day),0) cur_units,
    coalesce(sum(b.product_revenue) filter (where b.sale_date=d.prev_day),0) prev_rev,
    coalesce(sum(b.units) filter (where b.sale_date=d.prev_day),0) prev_units
  from days d left join sb b on b.sale_date in (d.cur_day,d.prev_day) group by d.i,d.cur_day
)
select jsonb_build_object('platform',(select plat from params),'days',(select days from params),'segment',(select seg from params),
  'listings',(select count(*) from picked),
  'daily',coalesce((select jsonb_agg(jsonb_build_object('day',cur_day,'shopee',round(cur_shopee,2),'ml',round(cur_ml,2),
    'units',cur_units,'prev_revenue',round(prev_rev,2),'prev_units',prev_units) order by i) from agg),'[]'::jsonb));
$function$;
revoke all on function public.commerce_dashboard_segment_series_v1(text,integer,text) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_segment_series_v1(text,integer,text) to service_role;
