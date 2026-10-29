-- Comparação anual: listas de produtos também só com produtos que já existiam no ano base, receita (R$) por produto e resumo dos novos.
-- Campos aditivos: nada do que já era devolvido muda de nome ou de valor.
-- Produto "novo" = nenhuma venda no ano base inteiro (prior.y = 0). "Antigo" = prior.y > 0.

-- Produtos do mês: top/up/down (todos) + top_old/up_old/down_old (só antigos) + old_total + new_summary.
create or replace function public.commerce_annual_month_v1(p_platform text default 'SHOPEE', p_month int default null, p_year int default null, p_base int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_shopee_sales_sku_daily_v1)) y,
         case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_month between 1 and 12 then p_month end mo
), p2 as (select y, coalesce(p_base,y-1) b, plat, mo from prm),
src as (
  select 'SHOPEE'::text plat, d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d
  union all
  select v.platform_code, v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE'
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
), skulinks as (
  select z.sku, jsonb_agg(jsonb_build_object('platform',z.platform,'id',z.id)) links from (
    select upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) sku, m.code platform,
           (array_agg(l.external_listing_id order by (l.listing_status<>'ACTIVE'), l.id))[1] id
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where lp.platform_sku is not null and lp.relation_status<>'REMOVED'
      and upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) in (select sku from skus)
    group by 1,2) z group by z.sku
), pm as materialized (
  select public.commerce_sku_prior_map_v1((select plat from cut),(select b from cut)) m
), skr as (
  select s.*, s.cu-s.bu d,
    coalesce(((select m from pm)->>s.sku)::bigint,0) py,
    row_number() over (order by s.cu desc, s.sku) r_top,
    row_number() over (order by (s.cu-s.bu) desc, s.sku) r_up,
    row_number() over (order by (s.cu-s.bu) asc, s.sku) r_dn,
    public.commerce_sku_name_v1(s.sku) pname,
    (select c.name from public.commerce_sku_category_v1 e join public.commerce_categories c on c.id=e.category_id where e.sku_norm=s.sku limit 1) cname
  from skus s
), sko as (
  select sku,
    row_number() over (order by cu desc, sku) o_top,
    row_number() over (order by (cu-bu) desc, sku) o_up,
    row_number() over (order by (cu-bu) asc, sku) o_dn
  from skr where py>0
), it as (
  select r.sku, r.d, r.py, r.r_top, r.r_up, r.r_dn, o.o_top, o.o_up, o.o_dn,
    jsonb_build_object('sku',r.sku,'name',r.pname,'category',r.cname,'cur',r.cu,'base',r.bu,'cur_rev',r.cr,'base_rev',r.br,
      'prior',jsonb_build_object('y',r.py),
      'links',coalesce((select k.links from skulinks k where k.sku=r.sku),'[]'::jsonb)) j
  from skr r left join sko o on o.sku=r.sku
)
select jsonb_build_object(
  'year',(select y from cut),'base_year',(select b from cut),'platform',(select plat from cut),'month',(select mo from cut),'as_of',(select a from cut),
  'months',coalesce((select jsonb_agg(jsonb_build_object('month',m,'weeks',
      (select jsonb_agg(jsonb_build_object('n',n,'cur',cu,'base',bu,'days',dcur) order by n) from wk2 x where x.m=y.m and (x.cu>0 or x.bu>0 or x.dcur>0))) order by m)
     from (select distinct m from wk2) y),'[]'::jsonb),
  'month_total',(select jsonb_build_object('cur',coalesce(sum(cu),0),'base',coalesce(sum(bu),0),'cur_rev',coalesce(sum(cr),0),'base_rev',coalesce(sum(br),0)) from skus),
  'old_total',(select jsonb_build_object('cur',coalesce(sum(cu),0),'base',coalesce(sum(bu),0),'cur_rev',coalesce(sum(cr),0),'base_rev',coalesce(sum(br),0)) from skr where py>0),
  'new_summary',(select jsonb_build_object('count',count(*),'cur',coalesce(sum(cu),0),'cur_rev',coalesce(sum(cr),0)) from skr where py=0 and cu>0),
  'top',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(j order by r_top) from it where r_top<=15),'[]'::jsonb) end,
  'up',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(j order by r_up) from it where r_up<=10 and d>0),'[]'::jsonb) end,
  'down',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(j order by r_dn) from it where r_dn<=10 and d<0),'[]'::jsonb) end,
  'top_old',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(j order by o_top) from it where o_top<=15),'[]'::jsonb) end,
  'up_old',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(j order by o_up) from it where o_up<=10 and d>0),'[]'::jsonb) end,
  'down_old',case when (select mo from cut) is null then '[]'::jsonb else coalesce((select jsonb_agg(j order by o_dn) from it where o_dn<=10 and d<0),'[]'::jsonb) end
);
$f$;

-- Produtos de um período (semana, bloco de dias, janela): products (todos) + products_old (só antigos) + receita + totais.
create or replace function public.commerce_annual_period_products_v1(
  p_platform text default 'SHOPEE', p_cur_from date default null, p_cur_to date default null, p_base_from date default null, p_base_to date default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         p_cur_from cf, p_cur_to ct, p_base_from bf, p_base_to bt
  where p_cur_from is not null and p_cur_to is not null and p_base_from is not null and p_base_to is not null
    and p_cur_to>=p_cur_from and p_base_to>=p_base_from and p_cur_to-p_cur_from<=99 and p_base_to-p_base_from<=99
), src as (
  select 'SHOPEE'::text plat, d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d, prm
   where d.sale_date between prm.cf and prm.ct or d.sale_date between prm.bf and prm.bt
  union all
  select v.platform_code, v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, prm
   where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE'
     and (v.sale_date between prm.cf and prm.ct or v.sale_date between prm.bf and prm.bt)
), agg as (
  select s.sku,
    coalesce(sum(s.units) filter (where s.sale_date between prm.cf and prm.ct),0) cu,
    coalesce(sum(s.units) filter (where s.sale_date between prm.bf and prm.bt),0) bu,
    coalesce(sum(s.rev) filter (where s.sale_date between prm.cf and prm.ct),0) cr,
    coalesce(sum(s.rev) filter (where s.sale_date between prm.bf and prm.bt),0) br
  from src s, prm where prm.plat='TODAS' or s.plat=prm.plat group by s.sku
), pm as materialized (
  select public.commerce_sku_prior_map_v1((select plat from prm),(select extract(year from bf)::int from prm)) m
), ag2 as (
  select a.*, coalesce(((select m from pm)->>a.sku)::bigint,0) py from agg a
), links as (
  select z.sku, jsonb_agg(jsonb_build_object('platform',z.platform,'id',z.id)) links from (
    select upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) sku, m.code platform,
           (array_agg(l.external_listing_id order by (l.listing_status<>'ACTIVE'), l.id))[1] id
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where lp.platform_sku is not null and lp.relation_status<>'REMOVED'
      and upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) in (select sku from agg)
    group by 1,2) z group by z.sku
), ranked as (
  select a.*, row_number() over (order by a.cu desc, a.bu desc, a.sku) r from ag2 a where a.cu>0 or a.bu>0
), ranked_old as (
  select a.sku, row_number() over (order by a.cu desc, a.bu desc, a.sku) ro from ag2 a where a.py>0 and (a.cu>0 or a.bu>0)
), it as (
  select r.r, o.ro,
    jsonb_build_object('sku',r.sku,'cur',r.cu,'base',r.bu,'cur_rev',r.cr,'base_rev',r.br,
      'name',public.commerce_sku_name_v1(r.sku),
      'category',(select c.name from public.commerce_sku_category_v1 e join public.commerce_categories c on c.id=e.category_id where e.sku_norm=r.sku limit 1),
      'prior',jsonb_build_object('y',r.py),
      'links',coalesce((select k.links from links k where k.sku=r.sku),'[]'::jsonb)) j
  from ranked r left join ranked_old o on o.sku=r.sku
  where r.r<=40 or o.ro<=40
)
select jsonb_build_object(
  'platform',(select plat from prm),'cur_from',(select cf from prm),'cur_to',(select ct from prm),'base_from',(select bf from prm),'base_to',(select bt from prm),
  'total',jsonb_build_object('cur',coalesce((select sum(cu) from agg),0),'base',coalesce((select sum(bu) from agg),0),'cur_rev',coalesce((select sum(cr) from agg),0),'base_rev',coalesce((select sum(br) from agg),0)),
  'total_old',jsonb_build_object('cur',coalesce((select sum(cu) from ag2 where py>0),0),'base',coalesce((select sum(bu) from ag2 where py>0),0),'cur_rev',coalesce((select sum(cr) from ag2 where py>0),0),'base_rev',coalesce((select sum(br) from ag2 where py>0),0)),
  'new_summary',(select jsonb_build_object('count',count(*),'cur',coalesce(sum(cu),0),'cur_rev',coalesce(sum(cr),0)) from ag2 where py=0 and cu>0),
  'products',coalesce((select jsonb_agg(j order by r) from it where r<=40),'[]'::jsonb),
  'products_old',coalesce((select jsonb_agg(j order by ro) from it where ro<=40),'[]'::jsonb));
$f$;
