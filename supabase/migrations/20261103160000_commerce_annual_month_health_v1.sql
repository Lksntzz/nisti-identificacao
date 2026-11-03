-- Resumo por mês: quantos anúncios (que já vendiam no ano-base) venderam bem no mês do ano-base,
-- quantos seguem vendendo bem no ano atual, quantos caíram e quantos cresceram. "Vender bem" = ao menos p_min unidades no mês.
create or replace function public.commerce_annual_month_health_v1(p_platform text default 'SHOPEE', p_year int default null, p_base int default null, p_min int default 20)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_current_sales_listing_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         greatest(1,least(coalesce(p_min,20),1000)) mn
), p2 as (select y, coalesce(p_base,y-1) b, plat, mn from prm),
r as materialized (
  select v.external_listing_id id, v.sale_date, v.units,
         extract(year from v.sale_date)::int yr, extract(month from v.sale_date)::int m
  from public.commerce_current_sales_listing_daily_v1 v, p2
  where v.sale_date >= make_date(p2.b,1,1) and v.sale_date < make_date(p2.y+1,1,1)
    and (p2.plat='TODAS' or v.platform_code=p2.plat)
), cut as (
  select p2.y, p2.b, p2.mn, coalesce((select max(sale_date) from r where yr=p2.y), make_date(p2.y,12,31)) a from p2
), cm as (
  select a, (a - interval '1 year')::date bcut, extract(month from a)::int cmon,
         (a+1 <> (date_trunc('month',a)+interval '1 month')::date) partial from cut
), old as (select distinct id from r where yr=(select b from cut)),
lm as (
  select r.id, r.m,
    coalesce(sum(r.units) filter (where r.yr=(select b from cut) and (not (select partial from cm) or r.m<>(select cmon from cm) or r.sale_date<=(select bcut from cm))),0) b,
    coalesce(sum(r.units) filter (where r.yr=(select y from cut)),0) c
  from r where r.id in (select id from old) group by 1,2
), cls as (
  select m, id, b, c, (b>=(select mn from cut)) bs, (c>=(select mn from cut)) cs from lm
), tit as materialized (
  select distinct on (l.external_listing_id) l.external_listing_id id, l.title from public.commerce_listings l
  where l.external_listing_id in (select id from old) order by l.external_listing_id, l.updated_at desc nulls last
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'as_of',(select a from cm),'current_month',(select cmon from cm),'partial',(select partial from cm),
  'min_units',(select mn from cut),'old_count',(select count(*) from old),
  'months',(select jsonb_agg(jsonb_build_object(
      'm',g.m,'future',g.m>(select cmon from cm),
      'base_strong',(select count(*) from cls k where k.m=g.m and k.bs),
      'kept',(select count(*) from cls k where k.m=g.m and k.bs and k.cs),
      'lost',(select count(*) from cls k where k.m=g.m and k.bs and not k.cs),
      'gained',(select count(*) from cls k where k.m=g.m and not k.bs and k.cs),
      'base_units',(select coalesce(sum(b),0) from cls k where k.m=g.m),
      'cur_units',(select coalesce(sum(c),0) from cls k where k.m=g.m),
      'lost_units',(select coalesce(sum(b-c),0) from cls k where k.m=g.m and k.bs and not k.cs),
      'lost_list',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',coalesce(tt.title,'Anúncio '||x.id),'base',x.b,'cur',x.c) order by x.b-x.c desc)
          from (select * from cls k where k.m=g.m and k.bs and not k.cs order by k.b-k.c desc limit 10) x left join tit tt on tt.id=x.id),'[]'::jsonb),
      'gained_list',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'title',coalesce(tt.title,'Anúncio '||x.id),'base',x.b,'cur',x.c) order by x.c-x.b desc)
          from (select * from cls k where k.m=g.m and not k.bs and k.cs order by k.c-k.b desc limit 5) x left join tit tt on tt.id=x.id),'[]'::jsonb)
    ) order by g.m) from generate_series(1,12) g(m)));
$f$;
revoke all on function public.commerce_annual_month_health_v1(text,int,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_month_health_v1(text,int,int,int) to service_role;
