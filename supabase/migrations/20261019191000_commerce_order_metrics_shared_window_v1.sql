-- All-platform order incidence uses the same common latest imported date as the Gestor.
CREATE OR REPLACE FUNCTION public.commerce_order_metrics_v1(p_platform text DEFAULT 'TODAS'::text, p_days integer DEFAULT 30, p_month text DEFAULT NULL::text, p_listing_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
with inputs as (
  select upper(coalesce(nullif(btrim(p_platform),''),'TODAS')) platform,
    case when p_days in (0,7,30,60,90) then p_days else 30 end days,
    case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
      then to_date(p_month||'-01','YYYY-MM-DD') else null::date end month_start
), listing as (
  select l.id,l.external_listing_id,
    case when m.code='MERCADO_LIVRE'
      then case when upper(coalesce(l.account_code,''))='NOVO'
        then 'ML_NOVO' else 'ML_ANTIGO' end
      else m.code end source
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where l.id=p_listing_id and l.listing_status='ACTIVE'
), sources as (
  select source from listing where p_listing_id is not null
  union
  select x.source from (values
    ('SHOPEE'),('ML_ANTIGO'),('ML_NOVO'),('AMAZON'),('TIKTOK')
  ) x(source)
  cross join inputs i
  where p_listing_id is null
    and (i.platform='TODAS'
      or i.platform=x.source
      or (i.platform='MERCADO_LIVRE' and x.source in ('ML_ANTIGO','ML_NOVO')))
), newest as (
  -- Match the Gestor's common imported window when combining platforms.
  select case when p_listing_id is null
    and (select platform from inputs) in ('TODAS','MERCADO_LIVRE')
    then min(v.last_day) else max(v.last_day) end max_day
  from (
    select s.source,max(d.sale_date) last_day
    from sources s
    left join public.commerce_current_sales_listing_daily_v1 d
      on d.platform_code=s.source
    group by s.source
  ) v
  where v.last_day is not null
), bounds as (
  select i.days,
    case when i.days=0 then i.month_start
      else greatest(date '2025-01-01',coalesce(n.max_day,
        (now() at time zone 'America/Sao_Paulo')::date-1)-(i.days-1)) end period_start,
    case when i.days=0 then
      case when i.month_start is null then null::date
        else (i.month_start+interval '1 month - 1 day')::date end
      else coalesce(n.max_day,(now() at time zone 'America/Sao_Paulo')::date-1)
    end period_end
  from inputs i cross join newest n
), platform_month as (
  select count(*)::int imported_periods,
    sum(s.net_orders)::bigint orders,
    sum(s.units)::bigint units,
    round(sum(s.product_revenue),2)::numeric revenue,
    max(s.period_end) imported_through
  from public.commerce_sales_summary_rows s
  join public.commerce_sales_snapshots sn
    on sn.id=s.snapshot_id and sn.is_current
  cross join bounds b
  where b.days=0 and s.period_start=b.period_start
    and s.platform_code in (select source from sources)
), daily_reference as (
  select sum(d.orders_with_item)::bigint order_item_incidents,
    sum(d.units)::bigint units,round(sum(d.product_revenue),2)::numeric revenue
  from public.commerce_current_sales_listing_daily_v1 d
  cross join bounds b
  where b.days<>0 and d.sale_date between b.period_start and b.period_end
    and d.platform_code in(select source from sources)
), listing_daily as (
  select sum(d.orders_with_item)::bigint order_item_incidents,
    sum(d.units)::bigint units,round(sum(d.product_revenue),2)::numeric revenue
  from public.commerce_current_sales_listing_daily_v1 d
  join listing l on l.external_listing_id=d.external_listing_id
    and l.source=d.platform_code
  cross join bounds b
  where (b.days<>0 or l.source<>'SHOPEE')
    and d.sale_date between b.period_start and b.period_end
), listing_month_shopee as (
  select sum(r.orders_with_item)::bigint order_item_incidents,
    sum(r.units)::bigint units,round(sum(r.product_revenue),2)::numeric revenue
  from public.commerce_sales_rows r
  join public.commerce_sales_snapshots sn
    on sn.id=r.snapshot_id and sn.is_current
  join public.commerce_shopee_sku_owner_reviewed_v1 owner
    on owner.source_sku_norm=public.commerce_nisti_sku_norm_v1(r.sku_norm)
  join listing l on l.id=owner.listing_id and l.source='SHOPEE'
  cross join bounds b
  where b.days=0 and r.period_start=b.period_start and r.platform_code='SHOPEE'
), listing_aggregate as (
  select case when (select days from bounds)=0
        and (select source from listing)='SHOPEE'
      then (select order_item_incidents from listing_month_shopee)
      else (select order_item_incidents from listing_daily)
    end order_item_incidents,
    case when (select days from bounds)=0
        and (select source from listing)='SHOPEE'
      then (select units from listing_month_shopee)
      else (select units from listing_daily) end units,
    case when (select days from bounds)=0
        and (select source from listing)='SHOPEE'
      then (select revenue from listing_month_shopee)
      else (select revenue from listing_daily) end revenue
), selected as (
  select b.*,
    case when b.days=0 then p.orders else null::bigint end exact_orders,
    case when b.days=0 then p.revenue else d.revenue end sales_revenue,
    case when b.days=0 then p.units else d.units end sales_units,
    case when b.days=0 then p.imported_through else null::date end imported_through,
    case when b.days=0 then p.imported_periods else 0 end imported_periods,
    case when b.days<>0 then d.order_item_incidents else null::bigint
      end window_order_item_incidents
  from bounds b cross join platform_month p cross join daily_reference d
)
select jsonb_build_object(
  'period_start',s.period_start,'period_end',s.period_end,
  'source_kind',case when s.days=0 then 'MONTHLY_IMPORTED'
    else 'DAILY_ITEMS' end,
  'platform',jsonb_build_object(
    'orders',s.exact_orders,
    'orders_kind',case when s.exact_orders is not null then 'DISTINCT_IMPORTED'
      else 'UNAVAILABLE' end,
    'order_item_incidents',s.window_order_item_incidents,
    'revenue',s.sales_revenue,'units',s.sales_units,
    'ticket_average',case when s.exact_orders>0
      then round(s.sales_revenue/s.exact_orders,2) else null end,
    'reference_per_item_order',case when s.window_order_item_incidents>0
      then round(s.sales_revenue/s.window_order_item_incidents,2)
      else null end,
    'imported_through',s.imported_through),
  'listing',case when p_listing_id is null
    or not exists(select 1 from listing) then null
    else jsonb_build_object(
      'order_item_incidents',la.order_item_incidents,
      'units',la.units,'revenue',la.revenue,
      'reference_per_item_order',case when la.order_item_incidents>0
        then round(la.revenue/la.order_item_incidents,2) else null end,
      'exact_orders',null,
      'ticket_average',null,
      'data_kind','ORDER_WITH_ITEM_INCIDENCE_NOT_DISTINCT')
    end,
  'aftercare',jsonb_build_object(
    'available',false,
    'cancelled_orders',null,'returned_orders',null,'refunded_orders',null,
    'refund_amount',null,'cancellation_rate',null,'delivery_sla',null,
    'reason','NO_POSTSALE_EVENTS_IMPORTED')
)
from selected s cross join listing_aggregate la;
$function$
