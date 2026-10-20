-- Image-only extension to commerce_sales_evolution_v1. Reuses the previous
-- read-only sales, classification and pagination logic unchanged.
-- Image precedence: unique scanner SKU > unique catalog SKU/reference image with
-- edition-year compatibility > unique product's active Shopee listing cover.
-- Never resolve by title, model family, year-incompatible aliases, or ambiguous owners.
-- When no proven image exists, the UI retains its Lucide fallback.
-- Commercial dashboard only. Shared Shopee SKU sales are grouped once by SKU;
-- preserve both advertisement IDs for one product without duplicating orders or
-- assigning untraceable order quantities separately to individual listings.
CREATE OR REPLACE FUNCTION public.commerce_sales_evolution_v1(p_platform text DEFAULT 'TODAS'::text, p_days integer DEFAULT 30, p_status text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
with inp as (
  select upper(coalesce(nullif(btrim(p_platform),''),'TODAS')) requested,
    case when p_days in (7,30,60,90) then p_days else 30 end days,
    upper(coalesce(nullif(btrim(p_status),''),'ALL')) selected_status,
    nullif(btrim(left(coalesce(p_search,''),120)),'') searched,
    greatest(1,least(coalesce(p_limit,25),50)) lim,
    greatest(0,least(coalesce(p_offset,0),10000)) offs
), source_selection as (
  select v.code from (values('SHOPEE'),('ML_ANTIGO'),('ML_NOVO')) v(code)
  cross join inp i where i.requested='TODAS' or i.requested=v.code
    or (i.requested='MERCADO_LIVRE' and v.code like 'ML_%')
), last_sales as (
  select s.code source,
    case when s.code='SHOPEE' then
      (select max(d.sale_date) from public.commerce_shopee_sales_sku_daily_v1 d
       join public.commerce_sales_import_batches b on b.id=d.batch_id
       where b.status='COMMITTED' and b.platform_code='SHOPEE')
    else
      (select max(d.sale_date) from public.commerce_current_sales_listing_daily_v1 d
       where d.platform_code=s.code)
    end last_day
  from source_selection s
), bounds as (
  select i.*,
    case when i.requested in ('TODAS','MERCADO_LIVRE')
      then (select min(last_day) from last_sales where last_day is not null)
      else (select max(last_day) from last_sales where last_day is not null)
    end latest
  from inp i
), windows as (
  select b.*,
    b.latest-(b.days-1) current_start,
    b.latest-b.days previous_end,
    b.latest-(b.days*2-1) previous_start
  from bounds b
), chosen_shopee_day as (
  select d.sale_date,max(b.snapshot_id) snapshot_id
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id
    and b.status='COMMITTED' and b.platform_code='SHOPEE'
  cross join windows w
  where 'SHOPEE' in (select code from source_selection)
    and d.sale_date between w.previous_start and w.latest
  group by d.sale_date
), raw as (
  select d.platform_code source,d.sale_date sale_date,
    public.commerce_nisti_sku_norm_v1(d.sku_norm) norm,
    d.external_listing_id external_id,d.units,d.product_revenue revenue
  from public.commerce_current_sales_listing_daily_v1 d
  cross join windows w
  where d.platform_code in (select code from source_selection where code like 'ML_%')
    and d.sale_date between w.previous_start and w.latest
  union all
  select 'SHOPEE'::text source,d.sale_date sale_date,
    public.commerce_nisti_sku_norm_v1(d.sku_norm) norm,
    null::text external_id,d.units,d.product_revenue revenue
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id
    and b.platform_code='SHOPEE' and b.status='COMMITTED'
  join chosen_shopee_day latest on latest.sale_date=d.sale_date
    and latest.snapshot_id=b.snapshot_id
), observed as (
  select source,count(distinct sale_date) filter(where sale_date between w.current_start and w.latest) current_days,
    count(distinct sale_date) filter(where sale_date between w.previous_start and w.previous_end) previous_days
  from raw cross join windows w group by source
), coverage as (
  select s.code source,coalesce(o.current_days,0) current_days,
    coalesce(o.previous_days,0) previous_days,
    coalesce(o.current_days,0)=(select days from windows) current_complete,
    coalesce(o.previous_days,0)=(select days from windows) previous_complete
  from source_selection s left join observed o on o.source=s.code
), sku_keys as (
  select r.*,
    case when r.source='SHOPEE'
      and coalesce(owner.canonical_sku_norm,r.norm) ~ '^AGMT(25|26|27)[A-Z0-9]{3,}(BB|BXB)$'
      then regexp_replace(regexp_replace(coalesce(owner.canonical_sku_norm,r.norm),
        '^AGMT(25|26|27)','AGMT'),'(BB|BXB)$','')
      when nullif(coalesce(owner.canonical_sku_norm,r.norm),'') is not null
        then coalesce(owner.canonical_sku_norm,r.norm)
      else 'AD:'||coalesce(nullif(r.external_id,''),'SEM_ID') end model_key
  from raw r
  -- Reuse previously approved aliases only; never infer a new SKU owner.
  left join public.commerce_shopee_sku_owner_reviewed_v1 owner
    on r.source='SHOPEE' and owner.source_sku_norm=r.norm
), summed as (
  select r.source,r.model_key,
    sum(r.units) filter(where r.sale_date between w.current_start and w.latest)::bigint current_units,
    round(sum(r.revenue) filter(where r.sale_date between w.current_start and w.latest),2)::numeric current_revenue,
    sum(r.units) filter(where r.sale_date between w.previous_start and w.previous_end)::bigint previous_units,
    round(sum(r.revenue) filter(where r.sale_date between w.previous_start and w.previous_end),2)::numeric previous_revenue,
    min(nullif(r.norm,'')) sample_sku,
    min(nullif(r.external_id,'')) source_listing_id,
    count(distinct nullif(r.norm,'')) distinct_skus
  from sku_keys r cross join windows w group by r.source,r.model_key
), active_raw as (
  select l.id listing_id,l.external_listing_id,l.title,lp.product_id,
    case when m.code='MERCADO_LIVRE' then
      case when upper(coalesce(l.account_code,''))='NOVO'
        then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end source,
    public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm
  from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  join public.commerce_listing_products lp on lp.listing_id=l.id
  where l.listing_status='ACTIVE' and lp.relation_status<>'REMOVED'
    and m.code in ('SHOPEE','MERCADO_LIVRE')
), active_keys as (
  select a.*,
    case when a.source='SHOPEE' and a.norm ~ '^AGMT(25|26|27)[A-Z0-9]{3,}(BB|BXB)$'
      then regexp_replace(regexp_replace(a.norm,'^AGMT(25|26|27)','AGMT'),'(BB|BXB)$','')
      when nullif(a.norm,'') is not null then a.norm
      else 'AD:'||coalesce(nullif(a.external_listing_id,''),'SEM_ID') end model_key
  from active_raw a
  where a.source in(select code from source_selection)
), catalog as (
  select a.source,a.model_key,
    min(a.title) title,
    case when count(distinct a.listing_id)=1 then min(a.external_listing_id)
      else null::text end listing_id,
    min(nullif(a.norm,'')) sku,
    array_agg(distinct a.external_listing_id order by a.external_listing_id)
      filter(where nullif(a.external_listing_id,'') is not null) listing_ids,
    (count(distinct a.product_id)=1) shared_product,
    count(distinct a.listing_id)::int active_listing_count
  from active_keys a group by a.source,a.model_key
), source_names as (
  select t.source,t.model_key,max(t.name) title
  from (
    select r.platform_code source,
      case when r.platform_code='SHOPEE'
        and coalesce(owner.canonical_sku_norm,
          public.commerce_nisti_sku_norm_v1(r.sku_norm))
            ~ '^AGMT(25|26|27)[A-Z0-9]{3,}(BB|BXB)$'
        then regexp_replace(regexp_replace(
          coalesce(owner.canonical_sku_norm,public.commerce_nisti_sku_norm_v1(r.sku_norm)),
          '^AGMT(25|26|27)','AGMT'),'(BB|BXB)$','')
        else coalesce(owner.canonical_sku_norm,
          public.commerce_nisti_sku_norm_v1(r.sku_norm)) end model_key,
      nullif(btrim(r.product_name),'') name
    from public.commerce_sales_rows r
    join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
    left join public.commerce_shopee_sku_owner_reviewed_v1 owner
      on r.platform_code='SHOPEE'
      and owner.source_sku_norm=public.commerce_nisti_sku_norm_v1(r.sku_norm)
    where r.platform_code in(select code from source_selection)
  ) t
  where nullif(t.model_key,'') is not null and t.name is not null
  group by t.source,t.model_key
), catalog_or_sales as (
  select coalesce(c.source,s.source) source,
    coalesce(c.model_key,s.model_key) model_key,
    coalesce(c.title,n.title) title,c.listing_id,c.sku,c.listing_ids,c.shared_product,c.active_listing_count,
    s.sample_sku,s.source_listing_id,s.distinct_skus,
    coalesce(s.current_units,0)::bigint current_units,
    coalesce(s.previous_units,0)::bigint previous_units,
    coalesce(s.current_revenue,0)::numeric current_revenue,
    coalesce(s.previous_revenue,0)::numeric previous_revenue
  from catalog c full outer join summed s
    on s.source=c.source and s.model_key=c.model_key
  left join source_names n on n.source=coalesce(c.source,s.source)
    and n.model_key=coalesce(c.model_key,s.model_key)
  where coalesce(s.current_units,0)>0 or coalesce(s.previous_units,0)>0
    or c.model_key is not null
), listing_sales_totals as (
  -- A SKU may have zero sales while ANOTHER variation on the same current
  -- active listing has confirmed sales. Count each resolved model once;
  -- do not attribute ambiguous multi-listing SKUs to any listing.
  select c.source,c.listing_id,
    sum(coalesce(s.current_units,0))::bigint current_units,
    round(sum(coalesce(s.current_revenue,0)),2)::numeric current_revenue
  from catalog c
  left join summed s on s.source=c.source and s.model_key=c.model_key
  where c.listing_id is not null
  group by c.source,c.listing_id
), scored as (
  select z.*,v.current_days,v.previous_days,v.current_complete,v.previous_complete,
    case when z.listing_id is not null then
      greatest(0,coalesce(ls.current_units,0)-z.current_units)
      else null::bigint end other_variations_current_units,
    case when z.listing_id is not null then
      greatest(0,coalesce(ls.current_revenue,0)-z.current_revenue)
      else null::numeric end other_variations_current_revenue,
    (z.current_units-z.previous_units)::bigint delta_units,
    case when z.previous_units>0
      then round(((z.current_units-z.previous_units)*100.0/z.previous_units),1)
      else null::numeric end growth_pct,
    case when not (v.current_complete and v.previous_complete) then 'INSUFFICIENT'
      when z.current_units=0 then 'ZERO'
      when z.previous_units=0 then 'NEW'
      when z.previous_units<3 or abs(z.current_units-z.previous_units)<2 then 'LOW_VOLUME'
      when z.current_units>=z.previous_units*1.2 then 'RISING'
      when z.current_units<=z.previous_units*0.8 then 'FALLING'
      else 'STABLE' end trend
  from catalog_or_sales z
  join coverage v on v.source=z.source
  left join listing_sales_totals ls on ls.source=z.source
    and ls.listing_id=z.listing_id
), filtered as (
  select s.* from scored s cross join inp i
  where (i.selected_status='ALL' or i.selected_status=s.trend)
    and (i.searched is null
      or s.model_key ilike '%'||i.searched||'%'
      or coalesce(s.title,'') ilike '%'||i.searched||'%'
      or coalesce(s.sample_sku,'') ilike '%'||i.searched||'%'
      or coalesce(s.listing_id,'') ilike '%'||i.searched||'%'
      or exists(select 1 from unnest(coalesce(s.listing_ids,array[]::text[])) AS listing_ref(id)
          where listing_ref.id ilike '%'||i.searched||'%')
      or (nullif(public.commerce_nisti_sku_norm_v1(i.searched),'') is not null
        and s.model_key ilike '%'||public.commerce_nisti_sku_norm_v1(i.searched)||'%'))
), paged as (
  select * from filtered
  order by case trend when 'FALLING' then 0 when 'ZERO' then 1
    when 'NEW' then 2 when 'RISING' then 3 when 'LOW_VOLUME' then 4
    when 'STABLE' then 5 else 6 end,
    greatest(current_revenue,previous_revenue) desc,model_key
  limit (select lim from inp) offset (select offs from inp)
), images_for_page as (
  -- Only the already paginated items. No lookup by product title or approximate SKU:
  -- a mismatched cover can be worse than a missing image.
  select p.*,
    coalesce(scanner.image_url, master.image_url, listing_image.image_url) image_url,
    case when scanner.image_url is not null then 'NISTI_SKU'
      when master.image_url is not null then 'CATALOG_SKU'
      when listing_image.image_url is not null then 'ACTIVE_LISTING_SKU'
      else null::text end image_source
  from paged p
  left join lateral (
    select case
      when count(*)=1 and max(nullif(btrim(np.image_key),'')) is not null
        then '/api/images/' || min(np.id)::text
      else null::text end image_url
    from public.products np
    where public.commerce_nisti_sku_norm_v1(np.sku)=coalesce(
      nullif(public.commerce_nisti_sku_norm_v1(p.sku),''),
      nullif(public.commerce_nisti_sku_norm_v1(p.sample_sku),''))
  ) scanner on true
  left join lateral (
    select case when count(distinct cp.id)=1 then
      max(case
        when nullif(btrim(cp.reference_image_url),'') ~* '^https://'
          and (nullif(btrim(cp.reference_image_sku),'') is null or
             public.commerce_image_years_compatible(ps.sku,cp.reference_image_sku,cp.name))
        then btrim(cp.reference_image_url)
        else null::text end)
      else null::text end image_url
    from public.commerce_product_skus ps
    join public.commerce_products cp on cp.id=ps.product_id
    where ps.is_active is distinct from false
      and public.commerce_nisti_sku_norm_v1(ps.sku)=coalesce(
        nullif(public.commerce_nisti_sku_norm_v1(p.sku),''),
        nullif(public.commerce_nisti_sku_norm_v1(p.sample_sku),''))
  ) master on true
  left join lateral (
    select case when count(distinct lp.product_id)=1
      then (array_agg(
        case when nullif(btrim(l.raw_metadata->'shopee_snapshot'->>'cover_image_url'),'')
                     ~* '^https://'
          then btrim(l.raw_metadata->'shopee_snapshot'->>'cover_image_url')
          else null::text end
        order by l.updated_at desc nulls last,l.id desc
      ) filter(where nullif(btrim(l.raw_metadata->'shopee_snapshot'->>'cover_image_url'),'') ~* '^https://'))[1]
      else null::text end image_url
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where l.listing_status='ACTIVE' and lp.relation_status<>'REMOVED'
      and m.code='SHOPEE' and p.source='SHOPEE'
      and public.commerce_nisti_sku_norm_v1(lp.platform_sku)=coalesce(
        nullif(public.commerce_nisti_sku_norm_v1(p.sku),''),
        nullif(public.commerce_nisti_sku_norm_v1(p.sample_sku),''))
  ) listing_image on true
)
select jsonb_build_object(
  'period_start',(select current_start from windows),
  'period_end',(select latest from windows),
  'previous_start',(select previous_start from windows),
  'previous_end',(select previous_end from windows),
  'days',(select days from inp),
  'coverage',coalesce((select jsonb_agg(to_jsonb(v) order by v.source) from coverage v),'[]'::jsonb),
  'total',(select count(*) from filtered),
  'kpis',jsonb_build_object(
    'rising',(select count(*) from scored where trend='RISING'),
    'falling',(select count(*) from scored where trend='FALLING'),
    'stable',(select count(*) from scored where trend='STABLE'),
    'zero',(select count(*) from scored where trend='ZERO'),
    'new',(select count(*) from scored where trend='NEW'),
    'low_volume',(select count(*) from scored where trend='LOW_VOLUME'),
    'insufficient',(select count(*) from scored where trend='INSUFFICIENT')
  ),
  'items',coalesce((select jsonb_agg(to_jsonb(p)) from images_for_page p),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_evolution_v1(text,integer,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_sales_evolution_v1(text,integer,text,text,integer,integer)
  to service_role;
