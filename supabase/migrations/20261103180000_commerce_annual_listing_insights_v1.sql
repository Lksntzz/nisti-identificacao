-- GA · comparação anual por anúncio (plataforma + ID), sem dependência de SKU.
-- RPC de leitura; anúncios novos não entram no grupo comparável.
create or replace function public.commerce_annual_listing_insights_v1(
  p_platform text default 'SHOPEE',
  p_year integer default null,
  p_base integer default null,
  p_min integer default 20,
  p_month integer default 1,
  p_listing_id text default null,
  p_listing_platform text default null
) returns jsonb
language sql stable security invoker
set search_path to 'public'
as $f$
with prm as (
  select
    case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO','TODAS')
      then upper(p_platform) else 'SHOPEE' end platform,
    coalesce(p_year,extract(year from current_date)::int) y,
    coalesce(p_base,coalesce(p_year,extract(year from current_date)::int)-1) b,
    case when p_min in (10,20,50,100) then p_min else 20 end mn,
    greatest(1,least(12,coalesce(p_month,1))) focus_month
), sales as materialized (
  select v.platform_code platform, v.external_listing_id id, v.sale_date,
    extract(year from v.sale_date)::int yr,
    extract(month from v.sale_date)::int mon,
    v.units::bigint units
  from public.commerce_current_sales_listing_daily_v1 v
  cross join prm p
  where v.sale_date >= make_date(p.b,1,1)
    and v.sale_date < make_date(p.y+1,1,1)
    and (p.platform='TODAS' or v.platform_code=p.platform)
    and nullif(btrim(v.external_listing_id),'') is not null
), availability as (
  select p.*,
    (select max(s.sale_date) from sales s where s.yr=p.y) last_sale,
    exists(select 1 from sales s where s.yr=p.b and s.units>0) base_available,
    exists(select 1 from sales s where s.yr=p.y and s.units>0) current_available
  from prm p
), cut as (
  select a.*,
    case when a.y<extract(year from current_date)::int then make_date(a.y,12,31)
         when a.y=extract(year from current_date)::int then a.last_sale
         else null::date end as_of
  from availability a
), bounds as (
  select c.*, coalesce(extract(month from c.as_of)::int,0) current_month,
    coalesce(extract(day from c.as_of)::int,0) current_day
  from cut c
), old_ads as materialized (
  select s.platform,s.id
  from sales s cross join bounds b
  where s.yr=b.b
  group by s.platform,s.id
  having count(*) filter(where s.units>0)>0
), new_ads as (
  select s.platform,s.id,sum(s.units)::bigint units
  from sales s cross join bounds b
  where s.yr=b.y and b.as_of is not null and s.sale_date<=b.as_of
    and not exists(select 1 from old_ads o where o.platform=s.platform and o.id=s.id)
  group by s.platform,s.id
  having sum(s.units)>0
), new_month as (
  select s.mon, count(distinct (s.platform,s.id)) filter(where s.units >= b.mn) strong
  from (
    select s.platform,s.id,s.mon,sum(s.units)::bigint units
    from sales s join new_ads n on n.platform=s.platform and n.id=s.id
    cross join bounds b
    where s.yr=b.y and s.sale_date<=b.as_of
    group by s.platform,s.id,s.mon
  ) s cross join bounds b
  group by s.mon
), ad_months as materialized (
  select o.platform,o.id,m.mon,
    coalesce(sum(s.units) filter (
      where s.yr=b.b and (
        m.mon<>b.current_month
        or b.current_day >= extract(day from
          (make_date(b.y,m.mon,1)+interval '1 month - 1 day')::date)::int
        or s.sale_date<=make_date(b.b,m.mon,
          least(b.current_day,extract(day from
            (make_date(b.b,m.mon,1)+interval '1 month - 1 day')::date)::int))
      )
    ),0)::bigint base_units,
    case when not b.current_available or m.mon>b.current_month then null::bigint
      else coalesce(sum(s.units) filter(where s.yr=b.y and s.sale_date<=b.as_of),0)::bigint
    end current_units
  from old_ads o cross join generate_series(1,12) m(mon) cross join bounds b
  left join sales s on s.platform=o.platform and s.id=o.id and s.mon=m.mon
  group by o.platform,o.id,m.mon,b.b,b.y,b.current_available,b.current_month,b.current_day,b.as_of
), monthly as (
  select d.mon,
    coalesce(sum(d.base_units),0)::bigint base_units,
    sum(d.current_units)::bigint current_units,
    count(*) filter(where d.base_units>=b.mn)::int base_strong,
    count(*) filter(where d.base_units>=b.mn and d.current_units>=b.mn)::int kept,
    count(*) filter(where d.base_units>=b.mn and d.current_units<b.mn)::int lost,
    count(*) filter(where d.base_units<b.mn and d.current_units>=b.mn)::int recovered,
    count(*) filter(where d.base_units>0 and d.current_units<d.base_units)::int falling,
    count(*) filter(where d.base_units>0 and d.current_units=0)::int stopped
  from ad_months d cross join bounds b
  group by d.mon
), yearly as (
  select sum(d.base_units) filter(where d.mon<=b.current_month)::bigint base_units,
    sum(d.current_units) filter(where d.mon<=b.current_month)::bigint current_units
  from ad_months d cross join bounds b
), yearly_ads as (
  select d.platform,d.id,
    sum(d.base_units) filter(where d.mon<=b.current_month)::bigint base_units,
    sum(d.current_units) filter(where d.mon<=b.current_month)::bigint current_units
  from ad_months d cross join bounds b
  group by d.platform,d.id
), selected_focus as (
  select d.*
  from ad_months d cross join bounds b
  where d.mon=b.focus_month and d.base_units>=b.mn and d.current_units is not null
  order by abs(d.current_units-d.base_units) desc,d.base_units desc,d.platform,d.id
  limit 40
), focus_meta as (
  select d.*,coalesce(nullif(l.title,''),'Anúncio '||d.id) title,
    l.url
  from selected_focus d
  left join lateral (
    select x.title,coalesce(nullif(x.canonical_url,''),nullif(x.source_url,'')) url
    from public.commerce_listings x join public.commerce_marketplaces mk on mk.id=x.marketplace_id
    where x.external_listing_id=d.id
      and ((d.platform='SHOPEE' and mk.code='SHOPEE')
        or (d.platform like 'ML_%' and mk.code='MERCADO_LIVRE'
          and upper(coalesce(x.account_code,''))=
            case when d.platform='ML_NOVO' then 'NOVO' else 'ANTIGO' end))
    order by (x.listing_status='ACTIVE') desc,x.updated_at desc nulls last,x.id desc
    limit 1
  ) l on true
)
select jsonb_build_object(
  'year',(select y from bounds),
  'base_year',(select b from bounds),
  'as_of',(select as_of from bounds),
  'last_sale',(select last_sale from bounds),
  'current_month',(select current_month from bounds),
  'base_available',(select base_available from bounds),
  'current_available',(select current_available from bounds),
  'min_units',(select mn from bounds),
  'old_count',(select count(*) from old_ads),
  'annual',jsonb_build_object(
    'base',(select base_units from yearly),
    'cur',(select current_units from yearly),
    'falling_ads',(select count(*) from yearly_ads a,bounds b
      where b.current_available and a.base_units>0 and a.current_units<a.base_units),
    'stopped_ads',(select count(*) from yearly_ads a,bounds b
      where b.current_available and a.base_units>0 and a.current_units=0)
  ),
  'new_ads',jsonb_build_object(
    'count',(select count(*) from new_ads),
    'units',(select coalesce(sum(units),0) from new_ads)
  ),
  'months',coalesce((select jsonb_agg(jsonb_build_object(
    'm',m.mon,'future',m.mon>(select current_month from bounds),
    'base_units',m.base_units,'cur_units',m.current_units,
    'base_strong',m.base_strong,'kept',m.kept,'lost',m.lost,
    'recovered',m.recovered,'falling',m.falling,'stopped',m.stopped,
    'new_strong',coalesce(n.strong,0)
  ) order by m.mon) from monthly m left join new_month n on n.mon=m.mon),'[]'::jsonb),
  'focus_month',(select focus_month from bounds),
  'focus_ads',coalesce((select jsonb_agg(jsonb_build_object(
    'id',f.id,'platform',f.platform,'title',f.title,'url',f.url,
    'base',f.base_units,'cur',f.current_units
  ) order by abs(f.current_units-f.base_units) desc,f.base_units desc)
    from focus_meta f),'[]'::jsonb),
  'listing_months',coalesce((select jsonb_agg(jsonb_build_object(
    'm',d.mon,'base',d.base_units,'cur',d.current_units
  ) order by d.mon)
    from ad_months d
    where p_listing_id is not null and d.id=p_listing_id
      and d.platform=upper(coalesce(p_listing_platform,''))),'[]'::jsonb)
);
$f$;
revoke all on function public.commerce_annual_listing_insights_v1(text,int,int,int,int,text,text) from public,anon,authenticated;
grant execute on function public.commerce_annual_listing_insights_v1(text,int,int,int,int,text,text) to service_role;
