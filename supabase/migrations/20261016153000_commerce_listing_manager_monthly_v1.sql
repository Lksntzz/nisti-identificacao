-- Monthly evolution for ACTIVE listing IDs only, never SKU-wide attributed sales.
create or replace function public.commerce_listing_manager_monthly_v1(
  p_platform text default 'TODAS'
) returns jsonb language sql stable security invoker set search_path=public
as $function$
with active_listing_ids as (
  select distinct l.external_listing_id,
    case when m.code='MERCADO_LIVRE'
      then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end
      else m.code end source
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where l.listing_status='ACTIVE'
    and (p_platform is null or upper(p_platform)='TODAS'
      or upper(p_platform)=m.code
      or (m.code='MERCADO_LIVRE' and upper(p_platform) in ('ML_ANTIGO','ML_NOVO')
        and upper(coalesce(l.account_code,''))=
          case when upper(p_platform)='ML_ANTIGO' then 'ANTIGO' else 'NOVO' end))
), sums as (
  select to_char(date_trunc('month',d.sale_date),'YYYY-MM') period,
    coalesce(sum(d.units),0)::bigint units,
    round(sum(d.product_revenue),2) revenue
  from public.commerce_current_sales_listing_daily_v1 d
  join active_listing_ids a on a.source=d.platform_code and a.external_listing_id=d.external_listing_id
  group by date_trunc('month',d.sale_date)
)
select jsonb_build_object('months',coalesce(
  (select jsonb_agg(jsonb_build_object('period',s.period,'units',s.units,'revenue',s.revenue)
    order by s.period) from sums s),'[]'::jsonb));
$function$;
revoke all on function public.commerce_listing_manager_monthly_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_listing_manager_monthly_v1(text) to service_role;
