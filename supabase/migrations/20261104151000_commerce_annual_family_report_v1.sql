-- GA: comparativo por familia confirmada. Ano da venda e ano da edicao nao sao intercambiaveis.
-- O SKU so entra no ranking se tiver um unico Produto Mestre proprietario.
create or replace function public.commerce_annual_family_report_v1(
  p_platform text default 'SHOPEE', p_year integer default null,
  p_base integer default null, p_family_id bigint default null)
returns jsonb language sql stable security invoker set search_path to 'public' as $sql$
with prm as (
  select upper(coalesce(p_platform,'SHOPEE')) platform,
    coalesce(p_year,extract(year from current_date)::integer) y,
    coalesce(p_base,coalesce(p_year,extract(year from current_date)::integer)-1) b
), source_sales as materialized (
  select s.platform_code platform, s.sale_date,
    extract(year from s.sale_date)::integer sales_year,
    extract(month from s.sale_date)::integer sales_month,
    s.external_listing_id listing_id, s.sku_norm sku,
    public.commerce_sku_canon_v1(s.sku_norm) sku_key,
    s.units::bigint units, s.product_revenue::numeric revenue
  from public.commerce_current_sales_listing_daily_v1 s cross join prm p
  where s.sale_date >= make_date(p.b,1,1)
    and s.sale_date < make_date(p.y+1,1,1)
    and (p.platform='TODAS' or s.platform_code=p.platform
      or (p.platform='MERCADO_LIVRE' and s.platform_code in ('ML_ANTIGO','ML_NOVO')))
), sku_owners as materialized (
  -- Vigencia declarada do SKU e aplicada ao ano da venda antes de escolher o proprietario.
  select public.commerce_sku_canon_v1(s.sku) sku_key, y.sales_year,
    min(s.product_id) product_id
  from public.commerce_product_skus s
  cross join (select distinct sales_year from source_sales) y
  where s.sku is not null
    and (s.valid_from_year is null or y.sales_year>=s.valid_from_year)
    and (s.valid_to_year is null or y.sales_year<=s.valid_to_year)
  group by public.commerce_sku_canon_v1(s.sku),y.sales_year
  having count(distinct s.product_id)=1
), tagged as materialized (
  select s.*, o.product_id, m.family_id
  from source_sales s
  left join sku_owners o on o.sku_key=s.sku_key and o.sales_year=s.sales_year
  left join public.commerce_products p on p.id=o.product_id
  left join public.commerce_product_family_members_v1 m on m.product_id=o.product_id
    -- Edicao 2027 nao pode receber venda de 2025 por um alias historico de SKU.
    and not (p.temporal_type='ANNUAL' and p.edition_year>s.sales_year+1)
), availability as (
  select p.*, max(t.sale_date) filter(where t.sales_year=p.y) as_of,
    count(*) filter(where t.sales_year=p.b)>0 base_available,
    count(*) filter(where t.sales_year=p.y)>0 current_available
  from prm p left join tagged t on true group by p.platform,p.y,p.b
), coverage as (
  select t.platform,t.sales_year,min(t.sale_date) first_date,max(t.sale_date) last_date,
    count(distinct t.sale_date)::integer days_present
  from tagged t group by t.platform,t.sales_year
), coverage_pairs as (
  select t.platform,
    count(*) filter(where t.sales_year=(select y from prm)) cur_rows,
    count(*) filter(where t.sales_year=(select b from prm)) base_rows
  from tagged t group by t.platform
), cuts as (
  select a.*,
    case when a.as_of is null then make_date(a.b,12,31) else make_date(a.b,
      extract(month from a.as_of)::integer,
      least(extract(day from a.as_of)::integer,
        extract(day from (make_date(a.b,extract(month from a.as_of)::integer,1)
          + interval '1 month - 1 day')::date)::integer)) end base_cut
  from availability a
), relevant as materialized (
  select t.*, case when t.sales_year=c.y and t.sale_date<=c.as_of then 'cur'
                     when t.sales_year=c.b and t.sale_date<=c.base_cut then 'base'
                end side
  from tagged t cross join cuts c
  where (t.sales_year=c.y and t.sale_date<=c.as_of)
    or (t.sales_year=c.b and t.sale_date<=c.base_cut)
), family_totals as (
  select t.family_id,
    coalesce(sum(t.units) filter(where t.side='cur'),0)::bigint cur_units,
    coalesce(sum(t.units) filter(where t.side='base'),0)::bigint base_units,
    coalesce(sum(t.revenue) filter(where t.side='cur'),0)::numeric(16,2) cur_revenue,
    coalesce(sum(t.revenue) filter(where t.side='base'),0)::numeric(16,2) base_revenue
  from relevant t where t.family_id is not null
  group by t.family_id
), family_list as (
  select f.id,f.name,f.model_name,f.format_name,c.name category,
    (select count(*) from public.commerce_product_family_members_v1 m where m.family_id=f.id)::integer member_count,
    coalesce(v.cur_units,0) cur_units,coalesce(v.base_units,0) base_units,
    coalesce(v.cur_revenue,0) cur_revenue,coalesce(v.base_revenue,0) base_revenue
  from public.commerce_product_families_v1 f
  join public.commerce_categories c on c.id=f.category_id
  left join family_totals v on v.family_id=f.id
), month_totals as (
  select t.sales_month,t.side,
    sum(t.units)::bigint units,sum(t.revenue)::numeric(16,2) revenue
  from relevant t
  where t.family_id is not null and (p_family_id is null or t.family_id=p_family_id)
  group by t.sales_month,t.side
), details as (
  select t.product_id,p.name product_name,p.edition_year,p.temporal_type,
    t.platform,t.listing_id,t.sku,t.sales_month as month,
    coalesce(sum(t.units) filter(where t.side='cur'),0)::bigint cur_units,
    coalesce(sum(t.units) filter(where t.side='base'),0)::bigint base_units,
    coalesce(sum(t.revenue) filter(where t.side='cur'),0)::numeric(16,2) cur_revenue,
    coalesce(sum(t.revenue) filter(where t.side='base'),0)::numeric(16,2) base_revenue
  from relevant t join public.commerce_products p on p.id=t.product_id
  where p_family_id is not null and t.family_id=p_family_id
  group by t.product_id,p.name,p.edition_year,p.temporal_type,t.platform,t.listing_id,t.sku,t.sales_month
), overall as (
  select coalesce(sum(units) filter(where side='cur'),0)::bigint cur_units,
    coalesce(sum(units) filter(where side='base'),0)::bigint base_units,
    coalesce(sum(revenue) filter(where side='cur'),0)::numeric(16,2) cur_revenue,
    coalesce(sum(revenue) filter(where side='base'),0)::numeric(16,2) base_revenue,
    coalesce(sum(units) filter(where side='cur' and family_id is null),0)::bigint unclassified_cur_units,
    coalesce(sum(units) filter(where side='base' and family_id is null),0)::bigint unclassified_base_units
  from relevant
)
select jsonb_build_object(
  'platform',(select platform from cuts),'year',(select y from cuts),'base_year',(select b from cuts),
  'as_of',(select as_of from cuts),'base_cut',(select base_cut from cuts),
  'base_available',(select base_available from cuts),
  'current_available',(select current_available from cuts),
  'platform_coverage',coalesce((select jsonb_agg(to_jsonb(v) order by v.platform,v.sales_year) from coverage v),'[]'::jsonb),
  'platforms_not_comparable',coalesce((select jsonb_agg(platform order by platform)
    from coverage_pairs where cur_rows=0 or base_rows=0),'[]'::jsonb),
  'selected_family_id',p_family_id,
  'overall',(select to_jsonb(o) from overall o),
  'families',coalesce((select jsonb_agg(to_jsonb(f) order by f.cur_units desc,f.name) from family_list f),'[]'::jsonb),
  'months',coalesce((select jsonb_agg(jsonb_build_object(
    'month',m.n,
    'base_units',case when not c.base_available or
      (c.current_available and m.n>extract(month from c.as_of)::integer)
      then null else coalesce((select x.units from month_totals x where x.sales_month=m.n and x.side='base'),0) end,
    'cur_units',case when not c.current_available or m.n>extract(month from c.as_of)::integer then null
                     else coalesce((select x.units from month_totals x where x.sales_month=m.n and x.side='cur'),0) end,
    'base_revenue',case when not c.base_available or
      (c.current_available and m.n>extract(month from c.as_of)::integer)
      then null else coalesce((select x.revenue from month_totals x where x.sales_month=m.n and x.side='base'),0) end,
    'cur_revenue',case when not c.current_available or m.n>extract(month from c.as_of)::integer then null
                       else coalesce((select x.revenue from month_totals x where x.sales_month=m.n and x.side='cur'),0) end,
    'future',c.as_of is null or m.n>extract(month from c.as_of)::integer
  ) order by m.n) from generate_series(1,12) m(n) cross join cuts c),'[]'::jsonb),
  'details',case when p_family_id is null then '[]'::jsonb else
    coalesce((select jsonb_agg(to_jsonb(d) order by d.month,d.cur_units desc,d.product_name,d.sku) from details d),'[]'::jsonb) end
);
$sql$;
revoke all on function public.commerce_annual_family_report_v1(text,integer,integer,bigint) from public,anon,authenticated;
grant execute on function public.commerce_annual_family_report_v1(text,integer,integer,bigint) to service_role;
