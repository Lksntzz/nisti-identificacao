-- Comparação anual: picos e sazonalidade (mês, categoria, dias de pico, produtos sazonais) e lançamentos (produtos sem venda no ano base).
-- Funções novas e somente de leitura; não alteram nenhuma função existente.

create or replace function public.commerce_annual_seasonality_v1(p_platform text default 'SHOPEE', p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_shopee_sales_sku_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat
), p2 as (select y, coalesce(p_base,y-1) b, plat from prm),
src as (
  select 'SHOPEE'::text plat, d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d, p2
   where d.sale_date >= make_date(p2.b,1,1) and d.sale_date < make_date(p2.y+1,1,1)
  union all
  select v.platform_code, v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, p2
   where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE'
     and v.sale_date >= make_date(p2.b,1,1) and v.sale_date < make_date(p2.y+1,1,1)
), r as materialized (
  select s.sale_date, s.sku, s.units, s.rev, extract(year from s.sale_date)::int yr, extract(month from s.sale_date)::int m
  from src s, p2 where p2.plat='TODAS' or s.plat=p2.plat
), cut as (
  select p2.y, p2.b, p2.plat, coalesce((select max(sale_date) from r where yr=p2.y), make_date(p2.y,12,31)) a from p2
), mm as (
  -- meses completos do ano atual: só eles entram na comparação de picos (o mês em andamento ainda não tem pico definido)
  select case when a+1=(date_trunc('month',a)+interval '1 month')::date then extract(month from a)::int else extract(month from a)::int-1 end done from cut
), mon as (
  select g.m,
    coalesce(sum(r.units) filter (where r.yr=(select b from cut)),0) bu,
    coalesce(sum(r.units) filter (where r.yr=(select y from cut)),0) cu,
    coalesce(sum(r.rev) filter (where r.yr=(select b from cut)),0) br,
    coalesce(sum(r.rev) filter (where r.yr=(select y from cut)),0) cr,
    count(distinct r.sale_date) filter (where r.yr=(select b from cut)) bd,
    count(distinct r.sale_date) filter (where r.yr=(select y from cut)) cd
  from generate_series(1,12) g(m) left join r on r.m=g.m group by g.m
), skus as materialized (select distinct sku from r),
cl as materialized (
  select k.sku, coalesce(e.category_id, pr.category_id) cid
  from skus k left join public.commerce_sku_category_v1 e on e.sku_norm=k.sku
  left join lateral (select p.category_id from public.commerce_sku_prefix_rules_v1 p
     where e.sku_norm is null and k.sku like p.prefix||'%' order by length(p.prefix) desc limit 1) pr on true
), cat as (
  select coalesce(c.name,'Sem categoria') cat, r.yr, r.m, sum(r.units) u
  from r join cl on cl.sku=r.sku left join public.commerce_categories c on c.id=cl.cid group by 1,2,3
), cat_tot as (select cat, sum(u) tot from cat group by cat),
dd as (select yr, sale_date, sum(units) u from r group by 1,2),
dw as (
  select yr, sale_date, u,
    avg(u) over (partition by yr order by sale_date rows between 28 preceding and 1 preceding) av,
    count(*) over (partition by yr order by sale_date rows between 28 preceding and 1 preceding) n
  from dd
), pk as (
  select dw.*, row_number() over (partition by yr order by (u-av) desc) rk
  from dw where n>=14 and av>0 and u>=1.4*av and u-av>=60
), pkp as (
  select p.yr, p.sale_date, p.u, p.av, p.rk,
    (select jsonb_agg(jsonb_build_object('sku',t.sku,'name',public.commerce_sku_name_v1(t.sku),'units',t.u) order by t.u desc)
       from (select sku, sum(units) u from r where r.sale_date=p.sale_date group by sku order by sum(units) desc limit 3) t) top
  from pk p where p.rk<=8
), fam as (
  select regexp_replace(sku,'^([A-Z]+)(2[4-9])','\1') fam, yr, m, sum(units) u from r group by 1,2,3
), famc as (select * from fam where m<=(select done from mm)),
fy as (select fam, yr, sum(u) tot, count(*) filter (where u>0) meses from famc group by 1,2),
fpk as (select distinct on (fam,yr) fam, yr, m pmo, u pu from famc order by fam, yr, u desc, m),
rep as (
  select distinct on (fam) fam, sku from (
    select regexp_replace(sku,'^([A-Z]+)(2[4-9])','\1') fam, sku, sum(units) u from r group by 1,2) z order by fam, u desc
), sp as (
  select a.fam, a.tot tb, c.tot tc, pa.pmo mpb, pa.pu pub, pc.pmo mpc, pc.pu puc,
    round(pa.pu/(a.tot::numeric/(select done from mm)),2) ib, round(pc.pu/(c.tot::numeric/(select done from mm)),2) ic
  from fy a
  join fy c on c.fam=a.fam and c.yr=(select y from cut) and a.yr=(select b from cut)
  join fpk pa on pa.fam=a.fam and pa.yr=a.yr join fpk pc on pc.fam=c.fam and pc.yr=c.yr
  where (select done from mm)>=3 and a.tot>=300 and c.tot>=300 and a.meses>=3 and c.meses>=3
), sp2 as (
  select sp.*, (abs(mpb-mpc)<=1 and ib>=1.5 and ic>=1.5) same,
    row_number() over (order by (abs(mpb-mpc)<=1 and ib>=1.5 and ic>=1.5) desc, tc desc) rk
  from sp
), fam_b as (select fam, m, sum(u) u from fam where yr=(select b from cut) group by 1,2),
fam_bt as (select fam, sum(u) tot from fam_b group by 1),
fam_bpk as (select distinct on (fam) fam, m, u from fam_b order by fam, u desc, m),
pend as (
  select k.fam, k.m, k.u, t.tot, row_number() over (order by k.u desc) rk
  from fam_bpk k join fam_bt t on t.fam=k.fam
  where k.m>(select done from mm) and t.tot>=500 and k.u/(t.tot/12.0)>=1.8
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'platform',(select plat from cut),'as_of',(select a from cut),
  'complete_months',(select done from mm),
  'months',(select jsonb_agg(jsonb_build_object('m',m,'base',bu,'cur',cu,'base_rev',br,'cur_rev',cr,'base_days',bd,'cur_days',cd) order by m) from mon),
  'categories',coalesce((select jsonb_agg(jsonb_build_object('name',ct.cat,'total',ct.tot,'months',
      (select jsonb_agg(jsonb_build_object('m',g.m,
          'base',coalesce((select u from cat x where x.cat=ct.cat and x.yr=(select b from cut) and x.m=g.m),0),
          'cur',coalesce((select u from cat x where x.cat=ct.cat and x.yr=(select y from cut) and x.m=g.m),0)) order by g.m)
         from generate_series(1,12) g(m))) order by ct.tot desc) from cat_tot ct where ct.tot>=200),'[]'::jsonb),
  'peak_days',jsonb_build_object(
    'base',coalesce((select jsonb_agg(jsonb_build_object('date',sale_date,'units',u,'avg',round(av,1),'top',coalesce(top,'[]'::jsonb)) order by rk) from pkp where yr=(select b from cut)),'[]'::jsonb),
    'cur',coalesce((select jsonb_agg(jsonb_build_object('date',sale_date,'units',u,'avg',round(av,1),'top',coalesce(top,'[]'::jsonb)) order by rk) from pkp where yr=(select y from cut)),'[]'::jsonb)),
  'seasonal_products',coalesce((select jsonb_agg(jsonb_build_object('family',s.fam,'sku',rp.sku,'name',public.commerce_sku_name_v1(rp.sku),
      'base_total',s.tb,'cur_total',s.tc,'base_peak_month',s.mpb,'base_peak_units',s.pub,'cur_peak_month',s.mpc,'cur_peak_units',s.puc,
      'base_index',s.ib,'cur_index',s.ic,'same',s.same) order by s.rk) from sp2 s left join rep rp on rp.fam=s.fam where s.rk<=20),'[]'::jsonb),
  'pending_peaks',coalesce((select jsonb_agg(jsonb_build_object('family',p.fam,'sku',rp.sku,'name',public.commerce_sku_name_v1(rp.sku),
      'peak_month',p.m,'peak_units',p.u,'total',p.tot) order by p.rk) from pend p left join rep rp on rp.fam=p.fam where p.rk<=8),'[]'::jsonb));
$f$;
revoke all on function public.commerce_annual_seasonality_v1(text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_seasonality_v1(text,int,int) to service_role;

create or replace function public.commerce_annual_launches_v1(p_platform text default 'SHOPEE', p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_shopee_sales_sku_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat
), p2 as (select y, coalesce(p_base,y-1) b, plat from prm),
src as (
  select 'SHOPEE'::text plat, d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d, p2
   where d.sale_date >= make_date(p2.y,1,1) and d.sale_date < make_date(p2.y+1,1,1)
  union all
  select v.platform_code, v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, p2
   where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE'
     and v.sale_date >= make_date(p2.y,1,1) and v.sale_date < make_date(p2.y+1,1,1)
), r as materialized (
  select s.sale_date, s.sku, s.units, s.rev from src s, p2 where p2.plat='TODAS' or s.plat=p2.plat
), cut as (select p2.y, p2.b, p2.plat, coalesce((select max(sale_date) from r), make_date(p2.y,12,31)) a from p2),
pm as materialized (select public.commerce_sku_prior_map_v1((select plat from cut),(select b from cut)) m),
cur as (
  select sku, sum(units) u, sum(rev) rv, min(sale_date) first_sale, max(sale_date) last_sale,
         coalesce(sum(units) filter (where sale_date>(select a from cut)-28),0) l28
  from r group by sku
), c2 as (select c.*, coalesce(((select m from pm)->>c.sku)::bigint,0) py from cur c),
nw as (select *, row_number() over (order by u desc, sku) rk from c2 where py=0 and u>0),
bymon as (
  select extract(month from first_sale)::int m, count(*) n, sum(u) u, sum(rv) rv from nw group by 1
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'platform',(select plat from cut),'as_of',(select a from cut),
  'total',jsonb_build_object('units',coalesce((select sum(u) from c2),0),'revenue',coalesce((select sum(rv) from c2),0)),
  'summary',jsonb_build_object('count',(select count(*) from nw),'units',coalesce((select sum(u) from nw),0),'revenue',coalesce((select sum(rv) from nw),0),
      'units_28d',coalesce((select sum(l28) from nw),0)),
  'by_month',coalesce((select jsonb_agg(jsonb_build_object('m',m,'count',n,'units',u,'revenue',rv) order by m) from bymon),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',public.commerce_sku_name_v1(sku),
      'category',(select c.name from public.commerce_sku_category_v1 e join public.commerce_categories c on c.id=e.category_id where e.sku_norm=nw.sku limit 1),
      'first_sale',first_sale,'last_sale',last_sale,'units',u,'revenue',rv,'units_28d',l28,
      'days',((select a from cut)-first_sale)+1) order by rk) from nw where rk<=60),'[]'::jsonb));
$f$;
revoke all on function public.commerce_annual_launches_v1(text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_launches_v1(text,int,int) to service_role;
