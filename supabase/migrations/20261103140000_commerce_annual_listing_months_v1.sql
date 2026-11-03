-- Anúncios que já vendiam no ano-base: unidades por mês nos dois anos (por número do anúncio).
-- Anúncio sem nenhuma venda no ano-base inteiro é "novo" e só entra no resumo (hidden_new).
create or replace function public.commerce_annual_listing_months_v1(p_platform text default 'SHOPEE', p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_current_sales_listing_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat
), p2 as (select y, coalesce(p_base,y-1) b, plat from prm),
r as materialized (
  select v.external_listing_id id, v.sale_date, v.units,
         extract(year from v.sale_date)::int yr, extract(month from v.sale_date)::int m
  from public.commerce_current_sales_listing_daily_v1 v, p2
  where v.sale_date >= make_date(p2.b,1,1) and v.sale_date < make_date(p2.y+1,1,1)
    and (p2.plat='TODAS' or v.platform_code=p2.plat)
), cut as (
  select p2.y, p2.b, coalesce((select max(sale_date) from r where yr=p2.y), make_date(p2.y,12,31)) a from p2
), cm as (
  select a, (a - interval '1 year')::date bcut, extract(month from a)::int cmon,
         (a+1 <> (date_trunc('month',a)+interval '1 month')::date) partial from cut
), lm as (
  select r.id, r.yr, r.m,
    sum(r.units) u_full
  from r group by 1,2,3
), bt as (select id, sum(u_full) tot from lm where yr=(select b from cut) group by 1),
ct as (select id, sum(u_full) tot from lm where yr=(select y from cut) group by 1),
old as (select b.id, b.tot btot, coalesce(c.tot,0) ctot from bt b left join ct c on c.id=b.id where b.tot>0),
top as (select * from old order by btot desc limit 80),
tit as materialized (
  select distinct on (l.external_listing_id) l.external_listing_id id, l.title from public.commerce_listings l
  where l.external_listing_id in (select id from top) order by l.external_listing_id, l.updated_at desc nulls last
), newl as (select c.id, c.tot from ct c where not exists (select 1 from bt b where b.id=c.id))
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'as_of',(select a from cm),'base_cut',(select bcut from cm),
  'current_month',(select cmon from cm),'partial',(select partial from cm),
  'old_count',(select count(*) from old),
  'listings',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',coalesce(tt.title,'Anúncio '||t.id),'base_total',t.btot,'cur_total',t.ctot,
      'months',(select jsonb_agg(jsonb_build_object('m',g.m,
          'base',coalesce((select m1.u_full from lm m1 where m1.id=t.id and m1.yr=(select b from cut) and m1.m=g.m and not ((select partial from cm) and g.m=(select cmon from cm))),
                          (select coalesce(sum(r.units),0) from r where r.id=t.id and r.yr=(select b from cut) and r.m=g.m and r.sale_date<=(select bcut from cm)),0),
          'cur',coalesce((select m2.u_full from lm m2 where m2.id=t.id and m2.yr=(select y from cut) and m2.m=g.m),0)) order by g.m)
        from generate_series(1,12) g(m))) order by t.btot desc)
    from top t left join tit tt on tt.id=t.id),'[]'::jsonb),
  'hidden_new',jsonb_build_object('count',(select count(*) from newl),'units',coalesce((select sum(tot) from newl),0)));
$f$;
revoke all on function public.commerce_annual_listing_months_v1(text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_annual_listing_months_v1(text,int,int) to service_role;
