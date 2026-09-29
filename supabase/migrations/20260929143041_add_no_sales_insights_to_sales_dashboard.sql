create or replace function public.commerce_sales_dashboard_v1(
  p_platform text default 'TODAS',
  p_period_start text default null,
  p_period_end text default null,
  p_sku text default null,
  p_status text default 'TODOS',
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security invoker
set search_path='public'
as $function$
with current_snapshot as (
  select s.*
  from public.commerce_sales_snapshots s
  where s.is_current=true
  order by s.id desc
  limit 1
),
params as (
  select
    case upper(trim(coalesce(p_platform,'TODAS')))
      when 'ML NOVO' then 'ML_NOVO'
      when 'ML ANTIGO' then 'ML_ANTIGO'
      when 'MERCADO LIVRE NOVO' then 'ML_NOVO'
      when 'MERCADO LIVRE ANTIGO' then 'ML_ANTIGO'
      when 'ML_NOVO' then 'ML_NOVO'
      when 'ML_ANTIGO' then 'ML_ANTIGO'
      when 'SHOPEE' then 'SHOPEE'
      else 'TODAS'
    end as selected_platform,
    upper(trim(coalesce(p_status,'TODOS'))) as selected_status,
    nullif(public.commerce_nisti_sku_norm_v1(p_sku),'') as selected_sku_norm,
    least(greatest(coalesce(p_limit,100),1),250) as page_limit,
    greatest(coalesce(p_offset,0),0) as page_offset
),
available_periods as (
  select
    sr.period_key,
    min(sr.period_start) as period_start,
    max(sr.period_end) as period_end
  from public.commerce_sales_summary_rows sr
  join current_snapshot cs on cs.id=sr.snapshot_id
  group by sr.period_key
),
bounds as (
  select
    coalesce(
      (select ap.period_start from available_periods ap where ap.period_key=p_period_start limit 1),
      (select min(ap.period_start) from available_periods ap)
    ) as start_date,
    coalesce(
      (select ap.period_end from available_periods ap where ap.period_key=p_period_end limit 1),
      (select max(ap.period_end) from available_periods ap)
    ) as end_date
),
period_ranked as (
  select ap.*, row_number() over(order by ap.period_start) as period_rank
  from available_periods ap
),
selected_end_period as (
  select pr.* from period_ranked pr cross join bounds b
  where pr.period_end=b.end_date limit 1
),
sales_filtered as (
  select r.*
  from public.commerce_sales_rows r
  join current_snapshot cs on cs.id=r.snapshot_id
  cross join params p
  cross join bounds b
  where r.period_start between b.start_date and b.end_date
    and (p.selected_platform='TODAS' or r.platform_code=p.selected_platform)
    and (p.selected_sku_norm is null or r.sku_norm=p.selected_sku_norm)
),
summary_filtered as (
  select r.*
  from public.commerce_sales_summary_rows r
  join current_snapshot cs on cs.id=r.snapshot_id
  cross join params p
  cross join bounds b
  where r.period_start between b.start_date and b.end_date
    and (p.selected_platform='TODAS' or r.platform_code=p.selected_platform)
),
source_defs(code,label,gestion_code,sort_order) as (
  values
    ('SHOPEE','Shopee','SHOPEE_GESTAO',1),
    ('ML_NOVO','ML Novo','ML_NOVO_GESTAO',2),
    ('ML_ANTIGO','ML Antigo','ML_ANTIGO_GESTAO',3)
),
selected_files as (
  select
    d.code,
    d.label,
    d.sort_order,
    (
      select f.id
      from public.commerce_source_files f
      where upper(f.source_code) in (d.code,d.gestion_code)
      order by
        case when upper(f.source_code)=d.gestion_code then 0 else 1 end,
        f.imported_at desc nulls last,
        f.id desc
      limit 1
    ) as source_file_id
  from source_defs d
),
catalog_raw as (
  select
    sf.code as platform_code,
    sf.label as platform_label,
    sf.sort_order,
    coalesce(
      nullif(trim(r.normalized_payload->>'sku'),''),
      nullif(trim(r.normalized_payload->>'sku_primary'),''),
      nullif(trim(r.normalized_payload->>'sku_base'),''),
      nullif(trim(r.normalized_payload->>'sku_secondary'),'')
    ) as sku,
    nullif(trim(r.normalized_payload->>'product_name'),'') as product_name,
    nullif(trim(r.normalized_payload->>'listing_url'),'') as listing_url,
    upper(trim(coalesce(r.normalized_payload->>'listing_status',''))) as listing_status
  from selected_files sf
  join public.commerce_source_rows r
    on r.source_file_id=sf.source_file_id
   and r.is_header=false
),
catalog_items as (
  select distinct on (cr.platform_code, public.commerce_nisti_sku_norm_v1(cr.sku))
    cr.platform_code,
    cr.platform_label,
    cr.sort_order,
    cr.sku,
    public.commerce_nisti_sku_norm_v1(cr.sku) as sku_norm,
    cr.product_name,
    cr.listing_url
  from catalog_raw cr
  cross join params p
  where nullif(public.commerce_nisti_sku_norm_v1(cr.sku),'') is not null
    and (p.selected_platform='TODAS' or cr.platform_code=p.selected_platform)
    and cr.listing_status not in ('INACTIVE','REMOVED','CANCELLED','CANCELED','PAUSED')
  order by
    cr.platform_code,
    public.commerce_nisti_sku_norm_v1(cr.sku),
    (cr.listing_url is not null) desc
),
sales_keys as (
  select distinct sf.platform_code,sf.sku_norm
  from sales_filtered sf
),
zero_items as (
  select ci.*
  from catalog_items ci
  cross join params p
  where (p.selected_sku_norm is null or ci.sku_norm=p.selected_sku_norm)
    and not exists (
      select 1
      from sales_keys sk
      where sk.platform_code=ci.platform_code
        and sk.sku_norm=ci.sku_norm
    )
),
historical_sales_by_item as (
  select
    r.platform_code,
    r.sku_norm,
    max(r.period_start) filter(
      where coalesce(r.units,0)>0 or coalesce(r.orders_with_item,0)>0 or coalesce(r.product_revenue,0)>0
    ) as last_sale_start,
    (
      array_agg(r.period_key order by r.period_start desc)
      filter(where coalesce(r.units,0)>0 or coalesce(r.orders_with_item,0)>0 or coalesce(r.product_revenue,0)>0)
    )[1] as last_sale_period,
    coalesce(sum(r.orders_with_item),0)::bigint as historical_orders,
    coalesce(sum(r.units),0)::bigint as historical_units,
    coalesce(round(sum(r.product_revenue),2),0)::numeric as historical_revenue
  from public.commerce_sales_rows r
  join current_snapshot cs on cs.id=r.snapshot_id
  cross join bounds b
  where r.period_start<=b.end_date
  group by r.platform_code,r.sku_norm
),
zero_enriched as (
  select
    zi.*,
    hs.last_sale_period,
    hs.last_sale_start,
    coalesce(hs.historical_orders,0)::bigint as historical_orders,
    coalesce(hs.historical_units,0)::bigint as historical_units,
    coalesce(hs.historical_revenue,0)::numeric as historical_revenue,
    case when hs.last_sale_period is null then null else greatest(0,sep.period_rank-lpr.period_rank)::bigint end as periods_without_sale,
    case
      when hs.last_sale_period is null then 'ALTA'
      when (sep.period_rank-lpr.period_rank)>=4 then 'ALTA'
      when (sep.period_rank-lpr.period_rank)>=2 then 'MEDIA'
      else 'BAIXA'
    end as review_priority,
    case
      when hs.last_sale_period is null then 'NUNCA_VENDEU'
      when (sep.period_rank-lpr.period_rank)>=6 then '6_PLUS'
      when (sep.period_rank-lpr.period_rank)>=4 then '4_5'
      when (sep.period_rank-lpr.period_rank)>=2 then '2_3'
      else '1'
    end as inactivity_bucket
  from zero_items zi
  left join historical_sales_by_item hs on hs.platform_code=zi.platform_code and hs.sku_norm=zi.sku_norm
  left join period_ranked lpr on lpr.period_key=hs.last_sale_period
  cross join selected_end_period sep
),
sold_items as (
  select
    sf.platform_code,
    case sf.platform_code
      when 'SHOPEE' then 'Shopee'
      when 'ML_NOVO' then 'ML Novo'
      when 'ML_ANTIGO' then 'ML Antigo'
    end as platform_label,
    sf.sku_primary,
    sf.sku,
    sf.sku_norm,
    (array_agg(sf.product_name order by sf.period_start desc)
      filter(where nullif(sf.product_name,'') is not null))[1] as product_name,
    sum(sf.units)::bigint as units,
    sum(sf.orders_with_item)::bigint as orders_with_item,
    round(sum(sf.product_revenue),2) as product_revenue,
    (array_agg(ci.listing_url order by (ci.listing_url is not null) desc)
      filter(where ci.listing_url is not null))[1] as listing_url
  from sales_filtered sf
  left join catalog_items ci
    on ci.platform_code=sf.platform_code
   and ci.sku_norm=sf.sku_norm
  group by sf.platform_code,sf.sku_primary,sf.sku,sf.sku_norm
),
combined_items as (
  select
    'SALE'::text as row_type,
    si.platform_code,
    si.platform_label,
    si.sku_primary,
    si.sku,
    si.sku_norm,
    si.product_name,
    si.units,
    si.orders_with_item,
    si.product_revenue,
    si.listing_url,
    null::text as last_sale_period,
    null::date as last_sale_start,
    0::bigint as periods_without_sale,
    0::bigint as historical_orders,
    0::bigint as historical_units,
    0::numeric as historical_revenue,
    null::text as review_priority,
    null::text as inactivity_bucket
  from sold_items si
  where (select selected_status from params) in ('TODOS','COM VENDA','COM_VENDA')

  union all

  select
    'ZERO'::text as row_type,
    zi.platform_code,
    zi.platform_label,
    null::text as sku_primary,
    zi.sku,
    zi.sku_norm,
    zi.product_name,
    0::bigint as units,
    0::bigint as orders_with_item,
    0::numeric as product_revenue,
    zi.listing_url,
    zi.last_sale_period,
    zi.last_sale_start,
    coalesce(zi.periods_without_sale,0)::bigint as periods_without_sale,
    zi.historical_orders,
    zi.historical_units,
    zi.historical_revenue,
    zi.review_priority,
    zi.inactivity_bucket
  from zero_enriched zi
  where (select selected_status from params) in ('TODOS','SEM VENDA','SEM_VENDA')
),
ranked_items as (
  select
    ci.*,
    count(*) over() as total_items
  from combined_items ci
),
paged_items as (
  select ri.*
  from ranked_items ri
  order by
    case ri.row_type when 'SALE' then 0 else 1 end,
    case
      when ri.row_type='ZERO' and ri.review_priority='ALTA' then 0
      when ri.row_type='ZERO' and ri.review_priority='MEDIA' then 1
      when ri.row_type='ZERO' and ri.review_priority='BAIXA' then 2
      else 9
    end,
    case when ri.row_type='ZERO' then coalesce(ri.periods_without_sale,999) else 0 end desc,
    case when ri.row_type='ZERO' then ri.historical_revenue else ri.product_revenue end asc,
    ri.units desc,
    ri.product_revenue desc,
    lower(coalesce(ri.product_name,'')),
    ri.sku
  limit (select page_limit from params)
  offset (select page_offset from params)
),
history as (
  select
    hx.period_key,
    min(hx.period_start) as period_start,
    sum(hx.net_orders)::bigint as net_orders,
    sum(hx.units)::bigint as units,
    round(sum(hx.product_revenue),2) as product_revenue
  from (
    select
      sf.period_key,
      sf.period_start,
      sf.net_orders,
      sf.units,
      sf.product_revenue
    from summary_filtered sf
    where (select selected_sku_norm from params) is null

    union all

    select
      s.period_key,
      s.period_start,
      sum(s.orders_with_item)::integer as net_orders,
      sum(s.units)::integer as units,
      sum(s.product_revenue)::numeric as product_revenue
    from sales_filtered s
    where (select selected_sku_norm from params) is not null
    group by s.period_key,s.period_start
  ) hx
  group by hx.period_key
),
no_sales_insights as (
  select jsonb_build_object(
    'total',count(*)::bigint,
    'never_sold',count(*) filter(where last_sale_period is null)::bigint,
    'previously_sold',count(*) filter(where last_sale_period is not null)::bigint,
    'review_first',count(*) filter(where review_priority='ALTA')::bigint,
    'review_medium',count(*) filter(where review_priority='MEDIA')::bigint,
    'review_low',count(*) filter(where review_priority='BAIXA')::bigint,
    'by_platform',coalesce((
      select jsonb_agg(jsonb_build_object('platform_code',x.platform_code,'platform_label',x.platform_label,'count',x.item_count) order by x.sort_order)
      from (
        select platform_code,platform_label,min(sort_order) sort_order,count(*)::bigint item_count
        from zero_enriched group by platform_code,platform_label
      ) x
    ),'[]'::jsonb),
    'inactivity_buckets',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key',x.inactivity_bucket,
          'label',case x.inactivity_bucket
            when 'NUNCA_VENDEU' then 'Nunca vendeu na base'
            when '6_PLUS' then '6+ períodos'
            when '4_5' then '4–5 períodos'
            when '2_3' then '2–3 períodos'
            else '1 período'
          end,
          'count',x.item_count
        )
        order by case x.inactivity_bucket when 'NUNCA_VENDEU' then 1 when '6_PLUS' then 2 when '4_5' then 3 when '2_3' then 4 else 5 end
      )
      from (select inactivity_bucket,count(*)::bigint item_count from zero_enriched group by inactivity_bucket) x
    ),'[]'::jsonb),
    'priorities',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'priority',x.review_priority,
          'label',case x.review_priority when 'ALTA' then 'Revisar primeiro' when 'MEDIA' then 'Acompanhar' else 'Recente' end,
          'count',x.item_count
        )
        order by case x.review_priority when 'ALTA' then 1 when 'MEDIA' then 2 else 3 end
      )
      from (select review_priority,count(*)::bigint item_count from zero_enriched group by review_priority) x
    ),'[]'::jsonb),
    'criteria',jsonb_build_object(
      'ALTA','Nunca vendeu na base disponível ou está há 4+ períodos sem venda',
      'MEDIA','Está há 2–3 períodos sem venda',
      'BAIXA','Está há 1 período sem venda'
    )
  ) as payload
  from zero_enriched
),
metric_values as (
  select
    case
      when p.selected_status in ('SEM VENDA','SEM_VENDA') then 0::bigint
      when p.selected_sku_norm is null
        then coalesce((select sum(sf.net_orders)::bigint from summary_filtered sf),0)
      else coalesce((select sum(sf.orders_with_item)::bigint from sales_filtered sf),0)
    end as net_orders,
    case
      when p.selected_status in ('SEM VENDA','SEM_VENDA') then 0::bigint
      else coalesce((select sum(sf.units)::bigint from sales_filtered sf),0)
    end as units,
    case
      when p.selected_status in ('SEM VENDA','SEM_VENDA') then 0::numeric
      else coalesce((select round(sum(sf.product_revenue),2) from sales_filtered sf),0)
    end as product_revenue,
    case
      when p.selected_status in ('SEM VENDA','SEM_VENDA') then 0::bigint
      else coalesce((
        select count(distinct sf.platform_code||'|'||coalesce(nullif(trim(sf.sku_primary),''),sf.sku_norm))::bigint
        from sales_filtered sf
      ),0)
    end as listings_with_sales,
    (select count(*)::bigint from zero_items) as items_without_sales,
    coalesce((
      select count(distinct sf.platform_code||'|'||sf.sku_norm)::bigint
      from sales_filtered sf
    ),0) as skus_with_sales
  from params p
)
select jsonb_build_object(
  'snapshot', (
    select jsonb_build_object(
      'id',cs.id,
      'source_name',cs.source_name,
      'data_through',cs.data_through,
      'imported_at',cs.imported_at,
      'row_count',cs.row_count
    )
    from current_snapshot cs
  ),
  'filters', jsonb_build_object(
    'platform',(select selected_platform from params),
    'period_start',(
      select ap.period_key
      from available_periods ap
      cross join bounds b
      where ap.period_start=b.start_date
      limit 1
    ),
    'period_end',(
      select ap.period_key
      from available_periods ap
      cross join bounds b
      where ap.period_end=b.end_date
      limit 1
    ),
    'sku',nullif(trim(coalesce(p_sku,'')),''),
    'status',(select selected_status from params)
  ),
  'options',jsonb_build_object(
    'platforms',jsonb_build_array(
      jsonb_build_object('value','TODAS','label','Todas'),
      jsonb_build_object('value','SHOPEE','label','Shopee'),
      jsonb_build_object('value','ML_NOVO','label','ML Novo'),
      jsonb_build_object('value','ML_ANTIGO','label','ML Antigo')
    ),
    'periods',coalesce((
      select jsonb_agg(
        jsonb_build_object('value',ap.period_key,'label',ap.period_key)
        order by ap.period_start
      )
      from available_periods ap
    ),'[]'::jsonb),
    'statuses',jsonb_build_array('TODOS','COM VENDA','SEM VENDA')
  ),
  'metrics',(
    select jsonb_build_object(
      'net_orders',mv.net_orders,
      'units',mv.units,
      'product_revenue',mv.product_revenue,
      'listings_with_sales',mv.listings_with_sales,
      'skus_with_sales',mv.skus_with_sales,
      'items_without_sales',mv.items_without_sales
    )
    from metric_values mv
  ),
  'no_sales_insights',coalesce((select nsi.payload from no_sales_insights nsi),'{}'::jsonb),
  'history',coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'period_key',h.period_key,
        'net_orders',h.net_orders,
        'units',h.units,
        'product_revenue',h.product_revenue
      )
      order by h.period_start
    )
    from history h
  ),'[]'::jsonb),
  'items',coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'row_type',pi.row_type,
        'platform_code',pi.platform_code,
        'platform_label',pi.platform_label,
        'sku_primary',pi.sku_primary,
        'sku',pi.sku,
        'product_name',pi.product_name,
        'units',pi.units,
        'orders_with_item',pi.orders_with_item,
        'product_revenue',pi.product_revenue,
        'listing_url',pi.listing_url,
        'last_sale_period',pi.last_sale_period,
        'last_sale_start',pi.last_sale_start,
        'periods_without_sale',pi.periods_without_sale,
        'historical_orders',pi.historical_orders,
        'historical_units',pi.historical_units,
        'historical_revenue',pi.historical_revenue,
        'review_priority',pi.review_priority,
        'inactivity_bucket',pi.inactivity_bucket
      )
      order by
        case pi.row_type when 'SALE' then 0 else 1 end,
        pi.units desc,
        pi.product_revenue desc,
        lower(coalesce(pi.product_name,'')),
        pi.sku
    )
    from paged_items pi
  ),'[]'::jsonb),
  'pagination',jsonb_build_object(
    'limit',(select page_limit from params),
    'offset',(select page_offset from params),
    'total',coalesce((select max(ri.total_items) from ranked_items ri),0)
  )
);
$function$;

revoke execute on function public.commerce_sales_dashboard_v1(text,text,text,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_sales_dashboard_v1(text,text,text,text,text,integer,integer)
  to service_role;
