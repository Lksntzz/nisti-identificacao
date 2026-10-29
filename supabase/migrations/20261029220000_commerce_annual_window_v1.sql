-- Janela de dias (7/30/60/90) contra as mesmas datas do ano anterior, dia a dia; limite de 100 dias também nos produtos do período.
create or replace function public.commerce_annual_window_v1(
  p_platform text default 'SHOPEE', p_cur_from date default null, p_cur_to date default null, p_base_from date default null, p_base_to date default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         p_cur_from cf, p_cur_to ct, p_base_from bf, p_base_to bt
  where p_cur_from is not null and p_cur_to is not null and p_base_from is not null and p_base_to is not null
    and p_cur_to>=p_cur_from and p_cur_to-p_cur_from<=99 and p_base_to-p_base_from=p_cur_to-p_cur_from
), src as (
  select 'SHOPEE'::text plat, d.sale_date, d.units
    from public.commerce_shopee_sales_sku_daily_v1 d, prm
   where d.sale_date between prm.cf and prm.ct or d.sale_date between prm.bf and prm.bt
  union all
  select v.platform_code, v.sale_date, v.units
    from public.commerce_current_sales_listing_daily_v1 v, prm
   where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE'
     and (v.sale_date between prm.cf and prm.ct or v.sale_date between prm.bf and prm.bt)
), per_day as (
  select s.sale_date, sum(s.units)::bigint u from src s, prm where prm.plat='TODAS' or s.plat=prm.plat group by s.sale_date
), cal as (
  select i, prm.cf+i cd, prm.bf+i bd from prm, generate_series(0,(select ct-cf from prm)) i
), rows_ as (
  select c.i, c.cd, c.bd, coalesce(a.u,0) cu, coalesce(b.u,0) bu from cal c
  left join per_day a on a.sale_date=c.cd left join per_day b on b.sale_date=c.bd
)
select jsonb_build_object(
  'platform',(select plat from prm),'cur_from',(select cf from prm),'cur_to',(select ct from prm),'base_from',(select bf from prm),'base_to',(select bt from prm),
  'total',jsonb_build_object('cur',coalesce((select sum(cu) from rows_),0),'base',coalesce((select sum(bu) from rows_),0)),
  'days',coalesce((select jsonb_agg(jsonb_build_object('cur_date',cd,'base_date',bd,'cur',cu,'base',bu) order by i) from rows_),'[]'::jsonb));
$f$;
revoke all on function public.commerce_annual_window_v1(text,date,date,date,date) from public,anon,authenticated;
grant execute on function public.commerce_annual_window_v1(text,date,date,date,date) to service_role;

-- commerce_annual_period_products_v1: limite do intervalo passa de 31 para 99 dias (patch via pg_get_functiondef + replace).
