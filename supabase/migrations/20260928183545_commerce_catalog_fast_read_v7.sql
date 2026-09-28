
create or replace function public.commerce_management_products_fast_v1(
  p_search text default null,
  p_category text default null,
  p_year integer default null,
  p_limit integer default 24,
  p_offset integer default 0
)
returns table(
  card_key text,
  product_id bigint,
  product_name text,
  master_sku text,
  category_name text,
  edition_year integer,
  image_url text,
  platform_count integer,
  presence_type text,
  platforms jsonb,
  link_review_status text,
  suggested_product_id bigint,
  candidate_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path='public'
as $function$
with sources(code,label,sort_order) as (
  values
    ('SHOPEE','Shopee',1),
    ('ML_NOVO','ML Novo',2),
    ('ML_ANTIGO','ML Antigo',3),
    ('AMAZON','Amazon',4),
    ('SHEIN','Shein',5)
),
selected_files as (
  select
    s.code,s.label,s.sort_order,
    (
      select f.id
      from public.commerce_source_files f
      where upper(f.source_code) in (s.code,s.code||'_GESTAO')
      order by
        case when upper(f.source_code)=s.code||'_GESTAO' then 0 else 1 end,
        f.imported_at desc nulls last,
        f.id desc
      limit 1
    ) as source_file_id
  from sources s
),
direct_rows as (
  select
    sf.code,
    sf.label,
    sf.sort_order,
    r.id as source_row_id,
    r.row_number as source_row_number,
    r.matched_product_id as product_id,
    r.matched_listing_id as listing_id,
    coalesce(
      nullif(btrim(r.normalized_payload->>'sku'),''),
      nullif(btrim(r.normalized_payload->>'sku_primary'),''),
      nullif(btrim(r.normalized_payload->>'sku_base'),''),
      nullif(btrim(r.normalized_payload->>'sku_secondary'),'')
    ) as sku,
    nullif(r.normalized_payload->>'product_name','') as source_product_name,
    nullif(r.normalized_payload->>'category','') as source_category,
    nullif(r.normalized_payload->>'listing_url','') as listing_url,
    coalesce(
      nullif(r.normalized_payload->>'linked_image_url',''),
      nullif(r.normalized_payload->>'image_url','')
    ) as source_image_url
  from selected_files sf
  join public.commerce_source_rows r
    on r.source_file_id=sf.source_file_id
   and r.is_header=false
   and r.matched_product_id is not null
),
variation_rows as (
  select
    sf.code,
    sf.label,
    sf.sort_order,
    r.id as source_row_id,
    r.row_number as source_row_number,
    lp.product_id,
    r.matched_listing_id as listing_id,
    coalesce(
      nullif(btrim(lp.platform_sku),''),
      nullif(btrim(ps.sku),''),
      nullif(btrim(r.normalized_payload->>'sku'),''),
      nullif(btrim(r.normalized_payload->>'sku_base'),'')
    ) as sku,
    cp.name as source_product_name,
    cc.name as source_category,
    nullif(r.normalized_payload->>'listing_url','') as listing_url,
    coalesce(
      nullif(r.normalized_payload->>'linked_image_url',''),
      nullif(r.normalized_payload->>'image_url','')
    ) as source_image_url
  from selected_files sf
  join public.commerce_source_rows r
    on r.source_file_id=sf.source_file_id
   and r.is_header=false
   and r.matched_product_id is null
   and r.resolution_status='VARIATION'
   and r.matched_listing_id is not null
  join public.commerce_listing_products lp
    on lp.listing_id=r.matched_listing_id
   and lp.relation_status='ACTIVE'
  join public.commerce_products cp
    on cp.id=lp.product_id
  left join public.commerce_categories cc
    on cc.id=cp.category_id
  left join public.commerce_product_skus ps
    on ps.id=lp.product_sku_id
),
resolved_rows as (
  select * from direct_rows
  union all
  select * from variation_rows
),
platform_groups as (
  select
    rr.product_id,
    rr.code as source_code,
    min(rr.label) as platform_label,
    min(rr.sort_order) as sort_order,
    count(*)::integer as item_count,
    jsonb_agg(
      jsonb_build_object(
        'source_row_id',rr.source_row_id,
        'source_code',rr.code,
        'label',rr.label,
        'sku',rr.sku,
        'product_name',rr.source_product_name,
        'category_name',rr.source_category,
        'listing_url',rr.listing_url,
        'image_url',rr.source_image_url
      )
      order by rr.source_row_number,rr.source_row_id
    ) as items,
    string_agg(coalesce(rr.sku,''),' ') as sku_text,
    (array_agg(rr.source_image_url order by rr.sort_order,rr.source_row_number)
      filter(where rr.source_image_url is not null))[1] as first_image_url
  from resolved_rows rr
  group by rr.product_id,rr.code
),
product_groups as (
  select
    pg.product_id,
    count(*)::integer as platform_count,
    jsonb_agg(
      jsonb_build_object(
        'source_code',pg.source_code,
        'label',pg.platform_label,
        'item_count',pg.item_count,
        'items',pg.items
      )
      order by pg.sort_order
    ) as platforms,
    string_agg(pg.sku_text,' ') as sku_text,
    (array_agg(pg.first_image_url order by pg.sort_order)
      filter(where pg.first_image_url is not null))[1] as first_image_url
  from platform_groups pg
  group by pg.product_id
),
cards as (
  select
    'PRODUCT:'||cp.id::text as card_key,
    cp.id as product_id,
    cp.name as product_name,
    cps.sku as master_sku,
    cc.name as category_name,
    cp.edition_year,
    case
      when cp.reference_image_source='NISTI_ID'
       and nullif(cp.reference_image_url,'') is not null
        then cp.reference_image_url
      else coalesce(nullif(pg.first_image_url,''),cp.reference_image_url)
    end as image_url,
    pg.platform_count,
    case when pg.platform_count>=2 then 'MULTI' else 'EXCLUSIVE' end as presence_type,
    pg.platforms,
    case
      when exists(
        select 1
        from public.commerce_nisti_product_links l
        where l.commerce_product_id=cp.id
          and l.sync_status='SYNCED'
      ) then 'NISTI_SYNCED'
      else 'NISTI_PENDING'
    end as link_review_status,
    cp.reference_image_source,
    cp.reference_image_url,
    concat_ws(' ',cp.name,cps.sku,pg.sku_text) as search_text
  from product_groups pg
  join public.commerce_products cp on cp.id=pg.product_id
  left join public.commerce_categories cc on cc.id=cp.category_id
  left join lateral (
    select ps.sku
    from public.commerce_product_skus ps
    where ps.product_id=cp.id
    order by
      case when ps.sku_type='CURRENT' and ps.is_active then 0
           when ps.is_active then 1
           else 2 end,
      ps.id
    limit 1
  ) cps on true
),
filtered as (
  select c.*
  from cards c
  where
    (nullif(btrim(coalesce(p_search,'')),'') is null
      or c.search_text ilike '%'||btrim(p_search)||'%')
    and (nullif(btrim(coalesce(p_category,'')),'') is null
      or upper(coalesce(c.category_name,''))=upper(btrim(p_category)))
    and (p_year is null or c.edition_year=p_year)
),
paged as (
  select f.*,count(*) over() as total_count
  from filtered f
  order by
    case f.presence_type when 'MULTI' then 0 else 1 end,
    lower(coalesce(f.product_name,'')),
    f.product_id
  limit least(greatest(coalesce(p_limit,24),1),100)
  offset greatest(coalesce(p_offset,0),0)
)
select
  p.card_key,
  p.product_id,
  p.product_name,
  p.master_sku,
  p.category_name,
  p.edition_year,
  p.image_url,
  p.platform_count,
  p.presence_type,
  public.commerce_sync_management_platforms_to_nisti_v2(
    public.commerce_enrich_management_platforms_v1(p.platforms),
    p.product_id,
    p.master_sku,
    p.edition_year,
    case when p.reference_image_source='NISTI_ID' then p.reference_image_url else null end
  ) as platforms,
  p.link_review_status,
  null::bigint as suggested_product_id,
  0::integer as candidate_count,
  p.total_count
from paged p;
$function$;

revoke execute on function public.commerce_management_products_fast_v1(text,text,integer,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_management_products_fast_v1(text,text,integer,integer,integer)
  to service_role;

create or replace function public.commerce_management_product_summary_v2()
returns jsonb
language sql
stable
security invoker
set search_path='public'
as $function$
with sources(code) as (
  values ('SHOPEE'),('ML_NOVO'),('ML_ANTIGO'),('AMAZON'),('SHEIN')
),
selected_files as (
  select
    s.code,
    (
      select f.id
      from public.commerce_source_files f
      where upper(f.source_code) in (s.code,s.code||'_GESTAO')
      order by
        case when upper(f.source_code)=s.code||'_GESTAO' then 0 else 1 end,
        f.imported_at desc nulls last,
        f.id desc
      limit 1
    ) as source_file_id
  from sources s
),
direct_presence as (
  select r.matched_product_id as product_id,sf.code
  from selected_files sf
  join public.commerce_source_rows r
    on r.source_file_id=sf.source_file_id
   and r.is_header=false
   and r.matched_product_id is not null
),
variation_presence as (
  select lp.product_id,sf.code
  from selected_files sf
  join public.commerce_source_rows r
    on r.source_file_id=sf.source_file_id
   and r.is_header=false
   and r.matched_product_id is null
   and r.resolution_status='VARIATION'
   and r.matched_listing_id is not null
  join public.commerce_listing_products lp
    on lp.listing_id=r.matched_listing_id
   and lp.relation_status='ACTIVE'
),
presence as (
  select product_id,count(distinct code)::integer as platform_count
  from (
    select * from direct_presence
    union all
    select * from variation_presence
  ) p
  group by product_id
),
base as (
  select coalesce(public.commerce_management_product_summary_v1(),'{}'::jsonb) as data
),
nisti as (
  select count(*)::bigint as synced
  from presence p
  where exists(
    select 1
    from public.commerce_nisti_product_links l
    where l.commerce_product_id=p.product_id
      and l.sync_status='SYNCED'
  )
),
counts as (
  select
    count(*)::bigint as linked_products,
    count(*) filter(where platform_count>=2)::bigint as multiplatform,
    count(*) filter(where platform_count=1)::bigint as exclusive
  from presence
)
select b.data || jsonb_build_object(
  'linked_products',c.linked_products,
  'multiplatform',c.multiplatform,
  'exclusive',c.exclusive,
  'nisti_synced',n.synced,
  'nisti_pending',greatest(c.linked_products-n.synced,0)
)
from base b
cross join counts c
cross join nisti n;
$function$;

revoke execute on function public.commerce_management_product_summary_v2()
  from public,anon,authenticated;
grant execute on function public.commerce_management_product_summary_v2()
  to service_role;
