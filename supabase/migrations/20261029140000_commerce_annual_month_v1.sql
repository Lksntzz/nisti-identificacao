-- Comparativo anual por mês: semanas (dias 1-7, 8-14, 15-21, 22-28, 29-fim) e produtos campeões de venda.
create or replace function public.commerce_annual_month_v1(p_platform text default 'SHOPEE', p_month int default null, p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_current_sales_listing_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_month between 1 and 12 then p_month end mo
), p2 as (select y, coalesce(p_base,y-1) b, plat, mo from prm),
src as (
  select 'SHOPEE'::text plat, d.sale_date, upper(regexp_replace(d.sku_norm,'[\s_]+','','g')) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d
  union all
  select v.platform_code, v.sale_date, upper(regexp_replace(v.sku_norm,'[\s_]+','','g')), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v where v.platform_code like 'ML%'
), f as (
  select s.*, extract(year from s.sale_date)::int yr from src s, p2
  where (p2.plat='TODAS' or s.plat=p2.plat) and s.sale_date >= make_date(p2.b,1,1) and s.sale_date < make_date(p2.y+1,1,1)
), cut as (
  select p2.*, coalesce((select max(sale_date) from f where yr=p2.y), make_date(p2.y,12,31)) a from p2
), fd as (
  select f.sale_date, f.sku, f.units, f.rev, f.yr, extract(month from f.sale_date)::int m, extract(day from f.sale_date)::int dd,
         case when f.yr=cut.y and f.sale_date<=cut.a then 'cur'
              when f.yr=cut.b and f.sale_date<=(cut.a - interval '1 year')::date then 'base' end per
  from f, cut where f.yr in (cut.y,cut.b)
), wk as (
  select m, least(((dd-1)/7)+1,5) n, per, sum(units) u, sum(rev) r, count(distinct sale_date) days
  from fd where per is not null group by 1,2,3
), wk2 as (
  select mo.m, w0.n,
    coalesce((select sum(u) from wk where wk.m=mo.m and wk.n=w0.n and per='cur'),0) cu,
    coalesce((select sum(u) from wk where wk.m=mo.m and wk.n=w0.n and per='base'),0) bu,
    coalesce((select max(days) from wk where wk.m=mo.m and wk.n=w0.n and per='cur'),0) dcur
  from (select generate_series(1,(select extract(month from a)::int from cut)) m) mo cross join generate_series(1,5) w0(n)
), sel as (select * from fd where m=(select mo from cut) and per is not null),
skus as (
  select sku, coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
         coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br
  from sel group by sku
), skr as (
  select s.*, s.cu-s.bu d,
    row_number() over (order by s.cu desc, s.sku) r_top,
    row_number() over (order by (s.cu-s.bu) desc, s.sku) r_up,
    row_number() over (order by (s.cu-s.bu) asc, s.sku) r_dn,
    (select pp.name from public.commerce_product_skus ps join public.commerce_products pp on pp.id=ps.product_id
       where upper(regexp_replace(ps.sku,'[\s_]+','','g'))=s.sku limit 1) pname,
    (select c.name from public.commerce_sku_category_v1 e join public.commerce_categories c on c.id=e.category_id where e.sku_norm=s.sku limit 1) cname
  from skus s
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'platform',(select plat from cut),'month',(select mo from cut),'as_of',(select a from cut),
  'months',coalesce((select jsonb_agg(jsonb_build_object('month',m,'weeks',
      (select jsonb_agg(jsonb_build_object('n',n,'cur',cu,'base',bu,'days',dcur) order by n) from wk2 x where x.m=y.m and (x.cu>0 or x.bu>0 or x.dcur>0))) order by m)
     from (select distinct m from wk2) y),'[]'::jsonb),
  'top',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'category',cname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br) order by r_top) from skr where r_top<=15),'[]'::jsonb) end,
  'up',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu) order by r_up) from skr where r_up<=5 and d>0),'[]'::jsonb) end,
  'down',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu) order by r_dn) from skr where r_dn<=5 and d<0),'[]'::jsonb) end
);
$f$;
revoke all on function public.commerce_annual_month_v1(text,int,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_month_v1(text,int,int,int) to service_role;
