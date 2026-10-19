-- Expose candidate active variation PK for explicit, auditable admin approval.
-- Advisory listing candidate data; never auto-attribute changed accessories.
-- Read-only Shopee sales with no uniquely confirmed active advertisement.
-- Preserves SKU text from the imported monthly spreadsheet. Daily rows only
-- store normalized SKUs, so use the matching monthly text when it exists.
-- Neither sale rows nor SKU mappings are changed or inferred.
create or replace function public.commerce_shopee_unlinked_sales_v1(
  p_days integer default 30,
  p_month text default null,
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with inputs as (
  select case when p_days in (0,7,30,60,90) then p_days else 30 end as days,
    case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
      then to_date(p_month||'-01','YYYY-MM-DD') else null::date end first_month,
    nullif(btrim(left(coalesce(p_search,''),120)),'') search,
    greatest(1,least(coalesce(p_limit,20),50)) lim,
    greatest(0,least(coalesce(p_offset,0),10000)) offs
), bounds as (
  select i.*,
    case when i.days=0 then i.first_month
      else least((now() at time zone 'America/Sao_Paulo')::date-1,
        coalesce((select max(d.sale_date)
          from public.commerce_current_sales_listing_daily_v1 d
          where d.platform_code='SHOPEE'),
        (now() at time zone 'America/Sao_Paulo')::date-1))-(i.days-1)
    end period_start,
    case when i.days=0 then (i.first_month+interval '1 month - 1 day')::date
      else least((now() at time zone 'America/Sao_Paulo')::date-1,
        coalesce((select max(d.sale_date)
          from public.commerce_current_sales_listing_daily_v1 d
          where d.platform_code='SHOPEE'),
        (now() at time zone 'America/Sao_Paulo')::date-1))
    end period_end
  from inputs i
), original_rows as (
  select public.commerce_nisti_sku_norm_v1(r.sku_norm) norm,
    coalesce(nullif(btrim(r.sku),''),nullif(btrim(r.sku_primary),''),r.sku_norm) original_sku,
    r.product_name,r.variation,r.units,r.product_revenue,r.period_start
  from public.commerce_sales_rows r
  join public.commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current
  cross join bounds b
  where r.platform_code='SHOPEE'
    and b.period_start is not null
    and r.period_start between date_trunc('month',b.period_start)::date
      and date_trunc('month',b.period_end)::date
), original_labels as (
  select norm,
    string_agg(distinct original_sku,' / ' order by original_sku) original_sku,
    max(product_name) product_name,max(variation) variation
  from original_rows group by norm
), monthly_groups as (
  select r.norm,sum(r.units)::bigint units,
    round(sum(r.product_revenue),2)::numeric revenue
  from original_rows r cross join bounds b
  where b.days=0 and r.period_start=b.first_month
  group by r.norm
), daily_source as (
  select d.sale_date,public.commerce_nisti_sku_norm_v1(d.sku_norm) norm,
    d.units,d.product_revenue,coalesce(b.snapshot_id,0) snapshot_id
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id
    and b.platform_code='SHOPEE' and b.status='COMMITTED'
  cross join bounds w
  where w.days<>0 and d.sale_date between w.period_start and w.period_end
    and not exists (
      select 1 from public.commerce_sales_listing_daily_v1 native
      join public.commerce_sales_import_batches nb on nb.id=native.batch_id
      where nb.platform_code='SHOPEE' and nb.status='COMMITTED'
        and native.sale_date=d.sale_date
    )
), latest_day as (
  select sale_date,max(snapshot_id) snapshot_id
  from daily_source group by sale_date
), daily_groups as (
  select d.norm,sum(d.units)::bigint units,
    round(sum(d.product_revenue),2)::numeric revenue
  from daily_source d
  join latest_day latest on latest.sale_date=d.sale_date
    and latest.snapshot_id=d.snapshot_id
  group by d.norm
), source_groups as (
  select m.norm,m.units,m.revenue from monthly_groups m
  union all
  select d.norm,d.units,d.revenue from daily_groups d
), owners as (
  select public.commerce_nisti_sku_norm_v1(lp.platform_sku) norm,count(*)::int uses
  from public.commerce_listing_products lp
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
  group by public.commerce_nisti_sku_norm_v1(lp.platform_sku)
), possible_active as (
  -- Advisory only: same model stem but changed year/binding is not verified.
  select s.norm sku,min(lp.id) possible_variation_id,min(l.id) possible_listing_id,
    min(l.external_listing_id) possible_external_listing_id,
    min(l.title) possible_listing_title,min(lp.platform_sku) possible_sku
  from source_groups s
  join public.commerce_listing_products lp on true
  join public.commerce_listings l on l.id=lp.listing_id
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where m.code='SHOPEE' and l.listing_status='ACTIVE'
    and lp.relation_status<>'REMOVED'
    and nullif(lp.variation_id,'') is not null
    and s.norm ~ '^AGMT(25|26|27)[A-Z0-9]+(BB|BXB)$'
    and public.commerce_nisti_sku_norm_v1(lp.platform_sku)
      ~ '^AGMT(25|26|27)[A-Z0-9]+(BB|BXB)$'
    and public.commerce_nisti_sku_norm_v1(lp.platform_sku)<>s.norm
    and regexp_replace(regexp_replace(s.norm,
      '^AGMT(25|26|27)','AGMT'),'(BB|BXB)$','')
      =regexp_replace(regexp_replace(
        public.commerce_nisti_sku_norm_v1(lp.platform_sku),
        '^AGMT(25|26|27)','AGMT'),'(BB|BXB)$','')
  group by s.norm
  having count(*)=1
), unlinked as (
  select s.norm sku_norm,
    coalesce(nullif(o.original_sku,''),s.norm,'SKU não informado') sku,
    o.product_name title,o.variation,
    s.units,s.revenue,
    case when coalesce(v.uses,0)>1 then 'SKU_DUPLICADO'
      when coalesce(v.uses,0)=1 then 'VINCULO_NAO_CONFIRMADO'
      else 'SEM_ANUNCIO_ATIVO' end status,
    (o.original_sku is not null) original_available,
    p.possible_variation_id,p.possible_listing_id,p.possible_external_listing_id,
    p.possible_listing_title,p.possible_sku
  from source_groups s
  left join original_labels o on o.norm=s.norm
  left join owners v on v.norm=s.norm
  left join possible_active p on p.sku=s.norm
  where not exists (select 1 from public.commerce_shopee_sku_owner_reviewed_v1 mapped
    where mapped.source_sku_norm=s.norm)
), searched as (
  select u.* from unlinked u cross join bounds b
  where b.search is null or u.sku ilike '%'||b.search||'%'
    or u.sku_norm ilike '%'||b.search||'%'
    or u.title ilike '%'||b.search||'%'
), page as (
  select * from searched order by units desc,sku
  limit (select lim from bounds) offset (select offs from bounds)
)
select jsonb_build_object(
  'period_start',(select period_start from bounds),
  'period_end',(select period_end from bounds),
  'source_kind',case when (select days from bounds)=0
    then 'MONTHLY_SKU_ORIGINAL' else 'DAILY_SKU_WITH_ORIGINAL_REFERENCE' end,
  'total',(select count(*) from searched),
  'units',(select coalesce(sum(units),0) from searched),
  'revenue',(select coalesce(round(sum(revenue),2),0) from searched),
  'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.units desc,p.sku)
    from page p),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_shopee_unlinked_sales_v1(integer,text,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_unlinked_sales_v1(integer,text,text,integer,integer)
  to service_role;
