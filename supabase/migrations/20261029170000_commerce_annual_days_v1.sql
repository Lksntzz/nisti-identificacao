-- GA: consulta historica DIARIA, somente leitura, limitada a sete datas de um mes.
-- Nao cria dados de venda e nao presume zero quando nao ha registro para o dia.
create or replace function public.commerce_annual_days_v1(
  p_platform text default 'SHOPEE',p_month int default null,p_week int default null,
  p_year int default null,p_base int default null
) returns jsonb language sql stable set search_path to 'public' as $fn$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int
    from public.commerce_current_sales_listing_daily_v1)) as y,
    case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO')
      then upper(p_platform) else 'TODAS' end as plat,
    p_month as mo,p_week as wk
), p2 as (
  select y,coalesce(p_base,y-1) as b,plat,mo,wk from prm
  where mo between 1 and 12 and wk between 1 and 5
), src as (
  select 'SHOPEE'::text plat,d.sale_date,d.units
    from public.commerce_shopee_sales_sku_daily_v1 d
  union all
  select v.platform_code,v.sale_date,v.units
    from public.commerce_current_sales_listing_daily_v1 v where v.platform_code like 'ML%'
), scoped as (
  select s.sale_date,sum(s.units)::bigint as units from src s cross join p2
  where (p2.plat='TODAS' or s.plat=p2.plat)
    and s.sale_date>=make_date(p2.b,1,1)
    and s.sale_date<make_date(p2.y+1,1,1)
  group by s.sale_date
), cut as (
  select p2.*,coalesce((select max(sale_date) from scoped
    where sale_date>=make_date(p2.y,1,1)
      and sale_date<make_date(p2.y+1,1,1)),make_date(p2.y,12,31)) as as_of
  from p2
), calendar as (
  select c.*,d as day,
    make_date(c.y,c.mo,d) as current_date,
    case when d<=extract(day from
      (make_date(c.b,c.mo,1)+interval '1 month - 1 day'))::int
      then make_date(c.b,c.mo,d) else null::date end as previous_date
  from cut c cross join lateral generate_series((c.wk-1)*7+1,
    least(c.wk*7,extract(day from
      (make_date(c.y,c.mo,1)+interval '1 month - 1 day'))::int)) d
), answer as (
  select cal.day,cal.current_date,cal.previous_date,
    case when cal.current_date<=cal.as_of then cur.units end as current_units,
    case when cal.current_date<=cal.as_of and cal.previous_date<=
      (cal.as_of-interval '1 year')::date then prev.units end as previous_units
  from calendar cal
  left join scoped cur on cur.sale_date=cal.current_date
  left join scoped prev on prev.sale_date=cal.previous_date
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),
  'platform',(select plat from cut),'month',(select mo from cut),
  'week',(select wk from cut),'as_of',(select as_of from cut),
  'days',coalesce((select jsonb_agg(jsonb_build_object(
    'day',day,'cur_date',current_date,'base_date',previous_date,
    'cur',current_units,'base',previous_units
  ) order by day) from answer),'[]'::jsonb)
);
$fn$;
revoke all on function public.commerce_annual_days_v1(text,int,int,int,int)
  from public,anon,authenticated;
grant execute on function public.commerce_annual_days_v1(text,int,int,int,int)
  to service_role;
