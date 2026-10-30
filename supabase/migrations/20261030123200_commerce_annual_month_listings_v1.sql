-- Comparação anual por ANÚNCIO + variações: fonte de vendas com proprietário
-- do anúncio confirmado, sem replicar unidades de SKUs compartilhados.
-- Fonte somente leitura; acesso reservado à API administrativa (service_role).
create or replace function public.commerce_annual_month_listings_v1(
  p_platform text default 'SHOPEE',
  p_month integer default 1,
  p_year integer default 2026,
  p_base integer default 2025,
  p_as_of date default null,
  p_tab text default 'TOP',
  p_history text default 'ALL',
  p_search text default null,
  p_limit integer default 15,
  p_offset integer default 0
) returns jsonb
language sql stable
security invoker
set search_path to 'public'
as $f$
with prm as (
  select upper(p_platform) platform, p_month mon, p_year yr, p_base byear,
    coalesce(p_as_of,make_date(p_year,12,31)) asof,
    upper(coalesce(p_tab,'TOP')) tab,
    upper(coalesce(p_history,'ALL')) history,
    nullif(btrim(coalesce(p_search,'')),'') search,
    greatest(1,least(coalesce(p_limit,15),30)) lim,
    greatest(0,least(coalesce(p_offset,0),20000)) off
  where upper(p_platform) in ('SHOPEE','ML_ANTIGO','ML_NOVO','TODAS')
    and p_month between 1 and 12
    and p_year between 2020 and 2100 and p_base=p_year-1
    and upper(coalesce(p_tab,'TOP')) in ('TOP','UP','DOWN','ZERO','NO_HISTORY')
    and upper(coalesce(p_history,'ALL')) in ('ALL','OLD','NO_HISTORY')
), dates as (
  select p.*,
    make_date(yr,mon,1) cf,make_date(byear,mon,1) bf,
    case when extract(year from asof)=yr and extract(month from asof)=mon
      then least(asof,(make_date(yr,mon,1)+interval '1 month - 1 day')::date)
      else (make_date(yr,mon,1)+interval '1 month - 1 day')::date end ct,
    case when extract(year from asof)=yr and extract(month from asof)=mon
      then make_date(byear,mon,least(extract(day from asof)::int,
                 extract(day from (make_date(byear,mon,1)+interval '1 month - 1 day')::date)::int))
      else (make_date(byear,mon,1)+interval '1 month - 1 day')::date end bt
  from prm p
), sku_sales as materialized (
  select v.platform_code platform, v.external_listing_id listing_id,
    public.commerce_sku_canon_v1(v.sku_norm) sku,
    coalesce(sum(v.units) filter(where v.sale_date between d.cf and d.ct),0)::bigint cur,
    coalesce(sum(v.units) filter(where v.sale_date between d.bf and d.bt),0)::bigint base
  from public.commerce_current_sales_listing_daily_v1 v
  cross join dates d
  where (d.platform='TODAS' or v.platform_code=d.platform)
    and ((v.sale_date between d.cf and d.ct) or (v.sale_date between d.bf and d.bt))
    and nullif(btrim(v.external_listing_id),'') is not null
  group by v.platform_code,v.external_listing_id,public.commerce_sku_canon_v1(v.sku_norm)
), totals as (
  select platform,listing_id,sum(cur)::bigint cur,sum(base)::bigint base,
    count(*)::int sold_skus
  from sku_sales
  group by platform,listing_id
), identified as (
  select t.*,(t.cur-t.base)::bigint diff,
    meta.internal_id,coalesce(nullif(meta.title,''),'Anúncio '||t.listing_id) title,
    meta.url
  from totals t
  left join lateral (
    select l.id internal_id,l.title,
      coalesce(nullif(l.canonical_url,''),nullif(l.source_url,'')) url
    from public.commerce_listings l
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where l.external_listing_id=t.listing_id
      and ((t.platform='SHOPEE' and m.code='SHOPEE')
        or (t.platform like 'ML_%' and m.code='MERCADO_LIVRE'
           and upper(coalesce(l.account_code,''))=
             case when t.platform='ML_NOVO' then 'NOVO' else 'ANTIGO' end))
    order by (l.listing_status='ACTIVE') desc,l.updated_at desc nulls last,l.id desc
    limit 1
  ) meta on true
), filtered as (
  select i.* from identified i cross join prm p
  where (p.tab='TOP' or (p.tab='UP' and i.diff>0)
    or (p.tab='DOWN' and i.diff<0)
    or (p.tab='ZERO' and i.base>0 and i.cur=0)
    or (p.tab='NO_HISTORY' and i.base=0 and i.cur>0))
    and (p.history='ALL' or (p.history='OLD' and i.base>0)
      or (p.history='NO_HISTORY' and i.base=0 and i.cur>0))
    and (p.search is null or strpos(lower(i.title),lower(p.search))>0
      or strpos(lower(i.listing_id),lower(p.search))>0
      or exists(select 1 from sku_sales sk where sk.platform=i.platform
        and sk.listing_id=i.listing_id and strpos(lower(sk.sku),lower(p.search))>0))
), ranked as (
  select f.*,row_number() over (
    order by case when p.tab='TOP' then f.cur end desc nulls last,
      case when p.tab in ('UP','NO_HISTORY') then f.diff end desc nulls last,
      case when p.tab in ('DOWN','ZERO') then f.diff end asc nulls last,
      f.cur desc,f.base desc,f.platform,f.listing_id
  ) rn
  from filtered f cross join prm p
), page as (
  select r.* from ranked r cross join prm p where r.rn>p.off and r.rn<=p.off+p.lim
)
select jsonb_build_object(
  'platform',(select platform from prm),
  'year',(select yr from prm),
  'base_year',(select byear from prm),
  'month',(select mon from prm),
  'as_of',(select asof from prm),
  'cur_from',(select cf from dates),'cur_to',(select ct from dates),
  'base_from',(select bf from dates),'base_to',(select bt from dates),
  'counts',(select jsonb_build_object(
    'listings',count(*),'up',count(*) filter(where diff>0),
    'down',count(*) filter(where diff<0),
    'zero',count(*) filter(where base>0 and cur=0),
    'no_history',count(*) filter(where base=0 and cur>0)) from identified),
  'total',(select count(*) from filtered),
  'items',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',r.listing_id,'internal_id',r.internal_id,'platform',r.platform,
      'title',r.title,'url',r.url,'cur',r.cur,'base',r.base,
      'variations_count',r.sold_skus,
      'variations',coalesce((
        select jsonb_agg(jsonb_build_object(
          'sku',s.sku,'name',coalesce(nullif(vname.variation_name,''),nullif(vname.platform_sku,''),s.sku),
          'cur',s.cur,'base',s.base) order by s.cur desc,s.base desc,s.sku)
        from sku_sales s
        left join lateral (
          select lp.variation_name,lp.platform_sku
          from public.commerce_listing_products lp
          where lp.listing_id=r.internal_id and lp.relation_status<>'REMOVED'
            and public.commerce_sku_canon_v1(lp.platform_sku)=s.sku
          order by (nullif(lp.variation_name,'') is not null) desc,lp.id
          limit 1
        ) vname on true
        where s.platform=r.platform and s.listing_id=r.listing_id
      ),'[]'::jsonb)
    ) order by r.rn) from page r
  ),'[]'::jsonb)
);
$f$;
revoke all on function public.commerce_annual_month_listings_v1(
  text,integer,integer,integer,date,text,text,text,integer,integer
) from public,anon,authenticated;
grant execute on function public.commerce_annual_month_listings_v1(
  text,integer,integer,integer,date,text,text,text,integer,integer
) to service_role;
