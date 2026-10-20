-- Read-only daily evidence. Missing observations remain null; Shopee links are partial SKU attribution.
create or replace function public.commerce_listing_diagnosis_daily_v1(
  p_listing_id bigint,p_start date,p_end date,p_scope text default 'ALL'
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select p_listing_id id,p_start first_day,p_end last_day,
    case when p_scope in ('ALL','ORGANIC','PAID') then p_scope else 'ALL' end scope
  where p_listing_id is not null and p_start is not null and p_end is not null
    and p_end>=p_start and p_end-p_start between 0 and 89
), ad as (
  select l.external_listing_id,
    case when m.code='MERCADO_LIVRE'
      then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
      else m.code end source_code
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  join params p on p.id=l.id
), dates as (
  select generate_series(p.first_day,p.last_day,interval '1 day')::date AS sale_day
  from params p
), known_sales as (
  select v.sale_date, sum(v.units)::bigint units,round(sum(v.product_revenue),2) revenue
  from public.commerce_current_sales_listing_daily_v1 v
  join ad a on a.external_listing_id=v.external_listing_id and a.source_code=v.platform_code
  join params p on v.sale_date between p.first_day and p.last_day
  group by v.sale_date
), known_visits as (
  select r.period_start AS sale_day,r.visits,r.impressions,r.clicks
  from public.commerce_listing_traffic_reports_v1 r
  join params p on p.id=r.listing_id and p.scope=r.traffic_scope
  where r.period_start=r.period_end and r.period_start between p.first_day and p.last_day
)
select jsonb_build_object(
  'scope',(select scope from params),
  'sales_attribution',case when (select source_code from ad)='SHOPEE'
    then 'Somente vendas com vínculo aprovado por SKU; não comprova todas as vendas do anúncio'
    else 'Somente vendas associadas ao ID do anúncio na origem importada' end,
  'items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'date',dt.sale_day,
      'units',s.units,'revenue',s.revenue,
      'visits',v.visits,'impressions',v.impressions,'clicks',v.clicks
    ) order by dt.sale_day)
    from dates dt
    left join known_sales s on s.sale_date=dt.sale_day
    left join known_visits v on v.sale_day=dt.sale_day
  ),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_listing_diagnosis_daily_v1(bigint,date,date,text)
  from public,anon,authenticated;
grant execute on function public.commerce_listing_diagnosis_daily_v1(bigint,date,date,text)
  to service_role;
