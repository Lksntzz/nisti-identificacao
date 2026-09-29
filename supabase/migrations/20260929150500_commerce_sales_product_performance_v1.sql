CREATE OR REPLACE FUNCTION public.commerce_sales_product_performance_v1(p_platform text DEFAULT 'TODAS'::text, p_period_start text DEFAULT NULL::text, p_period_end text DEFAULT NULL::text, p_situation text DEFAULT 'TODOS'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
params as (
  select
    case upper(trim(coalesce(p_platform,'TODAS')))
      when 'SHOPEE' then 'SHOPEE'
      when 'ML_NOVO' then 'ML_NOVO'
      when 'ML_ANTIGO' then 'ML_ANTIGO'
      else 'TODAS'
    end as selected_platform,
    case upper(trim(coalesce(p_situation,'TODOS')))
      when 'VENDEU' then 'VENDEU'
      when 'NAO_VENDEU' then 'NAO_VENDEU'
      when 'VENDE_OUTRA_PLATAFORMA' then 'VENDE_OUTRA_PLATAFORMA'
      when 'SEM_ANUNCIO' then 'SEM_ANUNCIO'
      else 'TODOS'
    end as selected_situation,
    nullif(trim(coalesce(p_search,'')),'') as search_text,
    greatest(1,least(250,coalesce(p_limit,100)))::integer as page_limit,
    greatest(0,coalesce(p_offset,0))::integer as page_offset
),
current_snapshot as (
  select s.*
  from public.commerce_sales_snapshots s
  where s.is_current=true
  order by s.id desc
  limit 1
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
requested_periods as (
  select
    coalesce(
      (select ap.period_start from available_periods ap where ap.period_key=p_period_start limit 1),
      (select min(ap.period_start) from available_periods ap)
    ) as start_date,
    coalesce(
      (select ap.period_end from available_periods ap where ap.period_key=p_period_end limit 1),
      (select max(ap.period_end) from available_periods ap)
    ) as end_date,
    coalesce(
      p_period_start,
      (select ap.period_key from available_periods ap order by ap.period_start limit 1)
    ) as start_key,
    coalesce(
      p_period_end,
      (select ap.period_key from available_periods ap order by ap.period_end desc limit 1)
    ) as end_key
),
bounds as (
  select
    least(start_date,end_date) as start_date,
    greatest(start_date,end_date) as end_date,
    case when start_date<=end_date then start_key else end_key end as start_key,
    case when start_date<=end_date then end_key else start_key end as end_key
  from requested_periods
),
product_sku_map as (
  select
    ps.product_id,
    ps.sku,
    ps.sku_type,
    public.commerce_nisti_sku_norm_v1(ps.sku) as sku_norm
  from public.commerce_product_skus ps
  where ps.is_active is distinct from false
    and nullif(trim(ps.sku),'') is not null
),
current_skus as (
  select distinct on (ps.product_id)
    ps.product_id,
    ps.sku as master_sku
  from public.commerce_product_skus ps
  where ps.sku_type='CURRENT'
    and ps.is_active is distinct from false
  order by ps.product_id,ps.updated_at desc nulls last,ps.id desc
),
products_base as (
  select
    p.id as product_id,
    nl.nisti_product_id,
    p.name as product_name,
    cs.master_sku,
    p.reference_image_url as image_url,
    p.internal_status
  from public.commerce_products p
  join current_skus cs on cs.product_id=p.id
  left join lateral (
    select l.nisti_product_id
    from public.commerce_nisti_product_links l
    where l.commerce_product_id=p.id
    order by l.updated_at desc nulls last,l.nisti_product_id desc
    limit 1
  ) nl on true
),
platform_defs(platform_code,platform_label,primary_source,fallback_source,sort_order) as (
  values
    ('SHOPEE','Shopee','SHOPEE_GESTAO','SHOPEE',1),
    ('ML_NOVO','ML Novo','ML_NOVO_GESTAO','ML_NOVO',2),
    ('ML_ANTIGO','ML Antigo','ML_ANTIGO_GESTAO','ML_ANTIGO',3)
),
latest_source_files as (
  select
    pd.*,
    coalesce(
      (
        select sf.id
        from public.commerce_source_files sf
        where upper(sf.source_code)=pd.primary_source
        order by sf.imported_at desc nulls last,sf.id desc
        limit 1
      ),
      (
        select sf.id
        from public.commerce_source_files sf
        where upper(sf.source_code)=pd.fallback_source
        order by sf.imported_at desc nulls last,sf.id desc
        limit 1
      )
    ) as source_file_id
  from platform_defs pd
),
source_presence_raw as (
  select
    lsf.platform_code,
    lsf.platform_label,
    lsf.sort_order,
    r.id as source_row_id,
    nullif(trim(coalesce(
      r.normalized_payload->>'sku',
      r.normalized_payload->>'sku_primary',
      r.normalized_payload->>'sku_base',
      r.normalized_payload->>'sku_secondary'
    )),'') as platform_sku,
    public.commerce_nisti_sku_norm_v1(coalesce(
      nullif(trim(r.normalized_payload->>'sku'),''),
      nullif(trim(r.normalized_payload->>'sku_primary'),''),
      nullif(trim(r.normalized_payload->>'sku_base'),''),
      nullif(trim(r.normalized_payload->>'sku_secondary'),'')
    )) as sku_norm,
    nullif(trim(r.normalized_payload->>'listing_url'),'') as listing_url,
    nullif(trim(r.normalized_payload->>'product_name'),'') as source_product_name
  from latest_source_files lsf
  join public.commerce_source_rows r
    on r.source_file_id=lsf.source_file_id
   and r.is_header=false
),
presence_by_product as (
  select
    psm.product_id,
    spr.platform_code,
    min(spr.platform_label) as platform_label,
    true as has_listing,
    (array_agg(spr.listing_url order by (spr.listing_url is null),spr.source_row_id)
      filter(where spr.listing_url is not null))[1] as listing_url,
    count(*)::bigint as listing_rows
  from source_presence_raw spr
  join product_sku_map psm on psm.sku_norm=spr.sku_norm
  where spr.sku_norm is not null
  group by psm.product_id,spr.platform_code
),
sales_by_product as (
  select
    psm.product_id,
    r.platform_code,
    coalesce(sum(r.orders_with_item),0)::bigint as orders,
    coalesce(sum(r.units),0)::bigint as units,
    coalesce(round(sum(r.product_revenue),2),0)::numeric as revenue
  from public.commerce_sales_rows r
  join current_snapshot cs on cs.id=r.snapshot_id
  join product_sku_map psm on psm.sku_norm=r.sku_norm
  cross join bounds b
  where r.period_start between b.start_date and b.end_date
  group by psm.product_id,r.platform_code
),
matrix as (
  select
    pb.*,
    coalesce(max(sp.units) filter(where sp.platform_code='SHOPEE'),0)::bigint as shopee_units,
    coalesce(max(sp.orders) filter(where sp.platform_code='SHOPEE'),0)::bigint as shopee_orders,
    coalesce(max(sp.revenue) filter(where sp.platform_code='SHOPEE'),0)::numeric as shopee_revenue,
    coalesce(bool_or(pp.has_listing) filter(where pp.platform_code='SHOPEE'),false) as shopee_has_listing,
    max(pp.listing_url) filter(where pp.platform_code='SHOPEE') as shopee_url,

    coalesce(max(sp.units) filter(where sp.platform_code='ML_NOVO'),0)::bigint as ml_novo_units,
    coalesce(max(sp.orders) filter(where sp.platform_code='ML_NOVO'),0)::bigint as ml_novo_orders,
    coalesce(max(sp.revenue) filter(where sp.platform_code='ML_NOVO'),0)::numeric as ml_novo_revenue,
    coalesce(bool_or(pp.has_listing) filter(where pp.platform_code='ML_NOVO'),false) as ml_novo_has_listing,
    max(pp.listing_url) filter(where pp.platform_code='ML_NOVO') as ml_novo_url,

    coalesce(max(sp.units) filter(where sp.platform_code='ML_ANTIGO'),0)::bigint as ml_antigo_units,
    coalesce(max(sp.orders) filter(where sp.platform_code='ML_ANTIGO'),0)::bigint as ml_antigo_orders,
    coalesce(max(sp.revenue) filter(where sp.platform_code='ML_ANTIGO'),0)::numeric as ml_antigo_revenue,
    coalesce(bool_or(pp.has_listing) filter(where pp.platform_code='ML_ANTIGO'),false) as ml_antigo_has_listing,
    max(pp.listing_url) filter(where pp.platform_code='ML_ANTIGO') as ml_antigo_url
  from products_base pb
  left join sales_by_product sp on sp.product_id=pb.product_id
  left join presence_by_product pp on pp.product_id=pb.product_id
  group by pb.product_id,pb.nisti_product_id,pb.product_name,pb.master_sku,pb.image_url,pb.internal_status
),
classified as (
  select
    m.*,
    (m.shopee_units+m.ml_novo_units+m.ml_antigo_units)::bigint as total_units,
    (m.shopee_orders+m.ml_novo_orders+m.ml_antigo_orders)::bigint as total_orders,
    round(m.shopee_revenue+m.ml_novo_revenue+m.ml_antigo_revenue,2)::numeric as total_revenue,
    (
      (case when m.shopee_has_listing or m.shopee_units>0 then 1 else 0 end) +
      (case when m.ml_novo_has_listing or m.ml_novo_units>0 then 1 else 0 end) +
      (case when m.ml_antigo_has_listing or m.ml_antigo_units>0 then 1 else 0 end)
    )::integer as active_platform_count,
    (
      (case when m.shopee_units>0 then 1 else 0 end) +
      (case when m.ml_novo_units>0 then 1 else 0 end) +
      (case when m.ml_antigo_units>0 then 1 else 0 end)
    )::integer as selling_platform_count,
    case (select selected_platform from params)
      when 'SHOPEE' then m.shopee_units
      when 'ML_NOVO' then m.ml_novo_units
      when 'ML_ANTIGO' then m.ml_antigo_units
      else (m.shopee_units+m.ml_novo_units+m.ml_antigo_units)
    end::bigint as selected_units
  from matrix m
),
statused as (
  select
    c.*,
    case
      when (select selected_platform from params)='TODAS' then
        case
          when c.active_platform_count=0 then 'SEM_ANUNCIO'
          when c.selling_platform_count=0 then 'NAO_VENDEU'
          when c.selling_platform_count<c.active_platform_count then 'VENDE_OUTRA_PLATAFORMA'
          else 'VENDEU'
        end
      else
        case
          when c.selected_units>0 then 'VENDEU'
          when c.total_units>0 then 'VENDE_OUTRA_PLATAFORMA'
          when c.active_platform_count=0 then 'SEM_ANUNCIO'
          else 'NAO_VENDEU'
        end
    end as situation
  from classified c
),
searched as (
  select s.*
  from statused s
  cross join params p
  where p.search_text is null
     or s.product_name ilike '%'||p.search_text||'%'
     or s.master_sku ilike '%'||p.search_text||'%'
     or exists(
       select 1
       from product_sku_map psm
       where psm.product_id=s.product_id
         and psm.sku ilike '%'||p.search_text||'%'
     )
),
summary as (
  select
    count(*)::bigint as analyzed,
    count(*) filter(where situation='VENDEU')::bigint as sold,
    count(*) filter(where situation='NAO_VENDEU')::bigint as no_sales,
    count(*) filter(where situation='VENDE_OUTRA_PLATAFORMA')::bigint as sells_elsewhere,
    count(*) filter(where situation='SEM_ANUNCIO')::bigint as no_listing
  from searched
),
filtered as (
  select s.*
  from searched s
  cross join params p
  where p.selected_situation='TODOS' or s.situation=p.selected_situation
),
counted as (
  select count(*)::bigint as total from filtered
),
paged as (
  select f.*
  from filtered f
  cross join params p
  order by
    case f.situation
      when 'NAO_VENDEU' then 0
      when 'VENDE_OUTRA_PLATAFORMA' then 1
      when 'VENDEU' then 2
      else 3
    end,
    lower(f.product_name),
    f.product_id
  limit (select page_limit from params)
  offset (select page_offset from params)
)
select jsonb_build_object(
  'snapshot',(
    select jsonb_build_object(
      'id',cs.id,
      'data_through',cs.data_through,
      'imported_at',cs.imported_at
    )
    from current_snapshot cs
  ),
  'filters',jsonb_build_object(
    'platform',(select selected_platform from params),
    'period_start',(select start_key from bounds),
    'period_end',(select end_key from bounds),
    'situation',(select selected_situation from params),
    'search',(select search_text from params)
  ),
  'options',jsonb_build_object(
    'platforms',jsonb_build_array(
      jsonb_build_object('value','TODAS','label','Todas as plataformas'),
      jsonb_build_object('value','SHOPEE','label','Shopee'),
      jsonb_build_object('value','ML_NOVO','label','ML Novo'),
      jsonb_build_object('value','ML_ANTIGO','label','ML Antigo')
    ),
    'situations',jsonb_build_array(
      jsonb_build_object('value','TODOS','label','Todas as situações'),
      jsonb_build_object('value','VENDEU','label','Vendeu'),
      jsonb_build_object('value','NAO_VENDEU','label','Não vendeu'),
      jsonb_build_object('value','VENDE_OUTRA_PLATAFORMA','label','Vende em outra plataforma'),
      jsonb_build_object('value','SEM_ANUNCIO','label','Sem anúncio')
    ),
    'periods',coalesce((
      select jsonb_agg(
        jsonb_build_object('value',ap.period_key,'label',ap.period_key)
        order by ap.period_start
      )
      from available_periods ap
    ),'[]'::jsonb)
  ),
  'summary',(
    select jsonb_build_object(
      'analyzed',s.analyzed,
      'sold',s.sold,
      'no_sales',s.no_sales,
      'sells_elsewhere',s.sells_elsewhere,
      'no_listing',s.no_listing
    )
    from summary s
  ),
  'items',coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'product_id',p.product_id,
        'nisti_product_id',p.nisti_product_id,
        'product_name',p.product_name,
        'master_sku',p.master_sku,
        'image_url',p.image_url,
        'internal_status',p.internal_status,
        'shopee',jsonb_build_object(
          'units',p.shopee_units,
          'orders',p.shopee_orders,
          'revenue',p.shopee_revenue,
          'has_listing',p.shopee_has_listing,
          'url',p.shopee_url
        ),
        'ml_novo',jsonb_build_object(
          'units',p.ml_novo_units,
          'orders',p.ml_novo_orders,
          'revenue',p.ml_novo_revenue,
          'has_listing',p.ml_novo_has_listing,
          'url',p.ml_novo_url
        ),
        'ml_antigo',jsonb_build_object(
          'units',p.ml_antigo_units,
          'orders',p.ml_antigo_orders,
          'revenue',p.ml_antigo_revenue,
          'has_listing',p.ml_antigo_has_listing,
          'url',p.ml_antigo_url
        ),
        'total_units',p.total_units,
        'total_orders',p.total_orders,
        'total_revenue',p.total_revenue,
        'situation',p.situation
      )
      order by
        case p.situation
          when 'NAO_VENDEU' then 0
          when 'VENDE_OUTRA_PLATAFORMA' then 1
          when 'VENDEU' then 2
          else 3
        end,
        lower(p.product_name),
        p.product_id
    )
    from paged p
  ),'[]'::jsonb),
  'pagination',jsonb_build_object(
    'limit',(select page_limit from params),
    'offset',(select page_offset from params),
    'total',(select total from counted)
  )
);
$function$;

revoke execute on function public.commerce_sales_product_performance_v1(text,text,text,text,text,integer,integer)
from public,anon,authenticated;
grant execute on function public.commerce_sales_product_performance_v1(text,text,text,text,text,integer,integer)
to service_role;
