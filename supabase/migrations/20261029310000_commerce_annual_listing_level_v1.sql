-- Picos/sazonalidade e lançamentos por ANÚNCIO (número do anúncio), com variações (SKUs) dentro de cada lançamento.
-- Substitui as duas funções criadas em 20261029290000 (mesma assinatura; novo formato do JSON).

create or replace function public.commerce_annual_seasonality_v1(p_platform text default 'SHOPEE', p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_current_sales_listing_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat
), p2 as (select y, coalesce(p_base,y-1) b, plat from prm),
r as materialized (
  select v.external_listing_id id, v.sale_date, v.units, v.product_revenue rev,
         extract(year from v.sale_date)::int yr, extract(month from v.sale_date)::int m
  from public.commerce_current_sales_listing_daily_v1 v, p2
  where v.sale_date >= make_date(p2.b,1,1) and v.sale_date < make_date(p2.y+1,1,1)
    and (p2.plat='TODAS' or v.platform_code=p2.plat)
), cut as (
  select p2.y, p2.b, p2.plat, coalesce((select max(sale_date) from r where yr=p2.y), make_date(p2.y,12,31)) a from p2
), mm as (
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
), tit as materialized (
  select distinct on (l.external_listing_id) l.external_listing_id id, l.title from public.commerce_listings l
  where l.external_listing_id in (select id from r) order by l.external_listing_id, l.updated_at desc nulls last
), lm as (select id, yr, m, sum(units) u from r group by 1,2,3),
lt as (select id, sum(u) tot, sum(u) filter (where yr=(select b from cut)) tb, sum(u) filter (where yr=(select y from cut)) tc from lm group by 1),
heat as (
  select id, tot, row_number() over (order by tot desc) rk from lt where coalesce(tb,0)+coalesce(tc,0) >= 300
),
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
    (select jsonb_agg(jsonb_build_object('id',t.id,'title',coalesce(tt.title,'Anúncio '||t.id),'units',t.u) order by t.u desc)
       from (select id, sum(units) u from r where r.sale_date=p.sale_date group by id order by sum(units) desc limit 3) t
       left join tit tt on tt.id=t.id) top
  from pk p where p.rk<=8
), lmc as (select * from lm where m<=(select done from mm)),
ly as (select id, yr, sum(u) tot, count(*) filter (where u>0) meses from lmc group by 1,2),
lpk as (select distinct on (id,yr) id, yr, m pmo, u pu from lmc order by id, yr, u desc, m),
sp as (
  select a.id, a.tot tb, c.tot tc, pa.pmo mpb, pa.pu pub, pc.pmo mpc, pc.pu puc,
    round(pa.pu/(a.tot::numeric/(select done from mm)),2) ib, round(pc.pu/(c.tot::numeric/(select done from mm)),2) ic
  from ly a
  join ly c on c.id=a.id and c.yr=(select y from cut) and a.yr=(select b from cut)
  join lpk pa on pa.id=a.id and pa.yr=a.yr join lpk pc on pc.id=c.id and pc.yr=c.yr
  where (select done from mm)>=3 and a.tot>=300 and c.tot>=300 and a.meses>=3 and c.meses>=3
), sp2 as (
  select sp.*, (abs(mpb-mpc)<=1 and ib>=1.5 and ic>=1.5) same,
    row_number() over (order by (abs(mpb-mpc)<=1 and ib>=1.5 and ic>=1.5) desc, tc desc) rk
  from sp
), bpk as (select distinct on (id) id, m, u from lm where yr=(select b from cut) order by id, u desc, m),
bt as (select id, sum(u) tot from lm where yr=(select b from cut) group by 1),
pend as (
  select k.id, k.m, k.u, t.tot, row_number() over (order by k.u desc) rk
  from bpk k join bt t on t.id=k.id
  where k.m>(select done from mm) and t.tot>=500 and k.u/(t.tot/12.0)>=1.8
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'platform',(select plat from cut),'as_of',(select a from cut),
  'complete_months',(select done from mm),
  'months',(select jsonb_agg(jsonb_build_object('m',m,'base',bu,'cur',cu,'base_rev',br,'cur_rev',cr,'base_days',bd,'cur_days',cd) order by m) from mon),
  'listings',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'title',coalesce(tt.title,'Anúncio '||h.id),'total',h.tot,'months',
      (select jsonb_agg(jsonb_build_object('m',g.m,
          'base',coalesce((select u from lm x where x.id=h.id and x.yr=(select b from cut) and x.m=g.m),0),
          'cur',coalesce((select u from lm x where x.id=h.id and x.yr=(select y from cut) and x.m=g.m),0)) order by g.m)
         from generate_series(1,12) g(m))) order by h.rk) from heat h left join tit tt on tt.id=h.id where h.rk<=12),'[]'::jsonb),
  'peak_days',jsonb_build_object(
    'base',coalesce((select jsonb_agg(jsonb_build_object('date',sale_date,'units',u,'avg',round(av,1),'top',coalesce(top,'[]'::jsonb)) order by rk) from pkp where yr=(select b from cut)),'[]'::jsonb),
    'cur',coalesce((select jsonb_agg(jsonb_build_object('date',sale_date,'units',u,'avg',round(av,1),'top',coalesce(top,'[]'::jsonb)) order by rk) from pkp where yr=(select y from cut)),'[]'::jsonb)),
  'seasonal_listings',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'title',coalesce(tt.title,'Anúncio '||s.id),
      'base_total',s.tb,'cur_total',s.tc,'base_peak_month',s.mpb,'base_peak_units',s.pub,'cur_peak_month',s.mpc,'cur_peak_units',s.puc,
      'base_index',s.ib,'cur_index',s.ic,'same',s.same) order by s.rk) from sp2 s left join tit tt on tt.id=s.id where s.rk<=20),'[]'::jsonb),
  'pending_peaks',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'title',coalesce(tt.title,'Anúncio '||p.id),
      'peak_month',p.m,'peak_units',p.u,'total',p.tot) order by p.rk) from pend p left join tit tt on tt.id=p.id where p.rk<=8),'[]'::jsonb));
$f$;
revoke all on function public.commerce_annual_seasonality_v1(text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_seasonality_v1(text,int,int) to service_role;

create or replace function public.commerce_annual_launches_v1(p_platform text default 'SHOPEE', p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_current_sales_listing_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat
), p2 as (select y, coalesce(p_base,y-1) b, plat from prm),
lv as materialized (
  select v.platform_code plat, v.external_listing_id id, v.sku_norm sku, v.sale_date, v.units, v.product_revenue rev,
         extract(year from v.sale_date)::int yr
  from public.commerce_current_sales_listing_daily_v1 v, p2
  where v.sale_date >= make_date(p2.b,1,1) and v.sale_date < make_date(p2.y+1,1,1)
    and (p2.plat='TODAS' or v.platform_code=p2.plat)
), cut as (select p2.y, p2.b, p2.plat, coalesce((select max(sale_date) from lv where yr=p2.y), make_date(p2.y,12,31)) a from p2),
cur as (
  select id, max(plat) plat, sum(units) u, sum(rev) rv, min(sale_date) first_sale, max(sale_date) last_sale,
         coalesce(sum(units) filter (where sale_date>(select a from cut)-28),0) l28
  from lv where yr=(select y from cut) group by id
), basey as (select id, sum(units) bu from lv where yr=(select b from cut) group by id),
nw as (
  select c.*, row_number() over (order by c.u desc, c.id) rk
  from cur c left join basey b on b.id=c.id where coalesce(b.bu,0)=0 and c.u>0
), tit as (
  select distinct on (l.external_listing_id) l.external_listing_id id, l.title, l.id lid from public.commerce_listings l
  where l.external_listing_id in (select id from nw) order by l.external_listing_id, l.updated_at desc nulls last
), vsku as (
  select lv.id, lv.sku, sum(lv.units) u, sum(lv.rev) rv,
         coalesce(sum(lv.units) filter (where lv.sale_date>(select a from cut)-28),0) l28,
         min(lv.sale_date) first_sale
  from lv where lv.yr=(select y from cut) and lv.id in (select id from nw) group by 1,2
), vlab as (
  select vs.id, vs.sku, vs.u, vs.rv, vs.l28, vs.first_sale,
    (select coalesce(nullif(lp.variation_name,''), nullif(lp.platform_sku,'')) from public.commerce_listing_products lp
      where lp.listing_id=(select lid from tit where tit.id=vs.id)
        and upper(regexp_replace(coalesce(lp.platform_sku,''),'[^A-Za-z0-9]','','g'))=upper(regexp_replace(vs.sku,'[^A-Za-z0-9]','','g'))
      order by (lp.variation_name is not null) desc limit 1) label
  from vsku vs
), bymon as (select extract(month from first_sale)::int m, count(*) n, sum(u) u, sum(rv) rv from nw group by 1)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'platform',(select plat from cut),'as_of',(select a from cut),
  'total',jsonb_build_object('units',coalesce((select sum(u) from cur),0),'revenue',coalesce((select sum(rv) from cur),0)),
  'summary',jsonb_build_object('count',(select count(*) from nw),'units',coalesce((select sum(u) from nw),0),'revenue',coalesce((select sum(rv) from nw),0),
      'units_28d',coalesce((select sum(l28) from nw),0),'variations',(select count(*) from vsku)),
  'by_month',coalesce((select jsonb_agg(jsonb_build_object('m',m,'count',n,'units',u,'revenue',rv) order by m) from bymon),'[]'::jsonb),
  'listings',coalesce((select jsonb_agg(jsonb_build_object('id',n.id,'platform',n.plat,'title',coalesce(t.title,'Anúncio '||n.id),
      'first_sale',n.first_sale,'last_sale',n.last_sale,'units',n.u,'revenue',n.rv,'units_28d',n.l28,
      'days',((select a from cut)-n.first_sale)+1,
      'variations',(select jsonb_agg(jsonb_build_object('sku',v.sku,'label',v.label,'units',v.u,'revenue',v.rv,'units_28d',v.l28,'first_sale',v.first_sale) order by v.u desc)
                    from (select * from vlab x where x.id=n.id order by x.u desc limit 15) v)) order by n.rk)
      from nw n left join tit t on t.id=n.id where n.rk<=60),'[]'::jsonb));
$f$;
revoke all on function public.commerce_annual_launches_v1(text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_launches_v1(text,int,int) to service_role;
