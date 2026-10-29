-- Painel Categorias v2: período (acumulado do ano, mês ou últimos N dias) contra as mesmas datas do ano anterior,
-- categorias e subcategorias em uma consulta e Top 5 que mais cresceram / mais caíram sob demanda por subcategoria.

create or replace function public.commerce_period_v1(p_platform text, p_year int, p_mode text, p_month int, p_days int)
returns table(plat text, y int, b int, as_of date, cf date, ct date, bf date, bt date)
language sql stable set search_path to 'public' as $f$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         coalesce(p_year,(select extract(year from max(sale_date))::int from public.commerce_shopee_sales_sku_daily_v1)) y
), a as (
  select prm.*, coalesce(greatest(
      case when prm.plat in ('SHOPEE','TODAS') then (select max(d.sale_date) from public.commerce_shopee_sales_sku_daily_v1 d
         where d.sale_date >= make_date(prm.y,1,1) and d.sale_date < make_date(prm.y+1,1,1)) end,
      case when prm.plat <> 'SHOPEE' then (select max(v.sale_date) from public.commerce_current_sales_listing_daily_v1 v
         where v.platform_code like 'ML%' and (prm.plat='TODAS' or v.platform_code=prm.plat)
           and v.sale_date >= make_date(prm.y,1,1) and v.sale_date < make_date(prm.y+1,1,1)) end),
      make_date(prm.y,12,31)) as_of from prm
), r as (
  select a.plat, a.y, a.y-1 b, a.as_of,
    case when p_mode='month' and p_month between 1 and 12 then make_date(a.y,p_month,1)
         when p_mode='days' and p_days between 1 and 99 then a.as_of-(p_days-1)
         else make_date(a.y,1,1) end cf,
    case when p_mode='month' and p_month between 1 and 12 then least(a.as_of,(make_date(a.y,p_month,1)+interval '1 month - 1 day')::date)
         else a.as_of end ct,
    (p_mode='days' and p_days between 1 and 99) is_days
  from a
)
select r.plat, r.y, r.b, r.as_of, r.cf, r.ct,
  case when r.is_days then (r.ct - interval '1 year')::date-(p_days-1) else (r.cf - interval '1 year')::date end,
  (r.ct - interval '1 year')::date
from r;
$f$;
revoke all on function public.commerce_period_v1(text,int,text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_period_v1(text,int,text,int,int) to service_role;

create or replace function public.commerce_categories_v2(p_platform text default 'SHOPEE', p_year int default null, p_mode text default 'ytd', p_month int default null, p_days int default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with pr as (select * from public.commerce_period_v1(p_platform,p_year,p_mode,p_month,p_days)),
src as (
  select d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d, pr
   where pr.plat in ('SHOPEE','TODAS') and (d.sale_date between pr.cf and pr.ct or d.sale_date between pr.bf and pr.bt)
  union all
  select v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, pr
   where pr.plat <> 'SHOPEE' and v.platform_code like 'ML%' and (pr.plat='TODAS' or v.platform_code=pr.plat)
     and (v.sale_date between pr.cf and pr.ct or v.sale_date between pr.bf and pr.bt)
), skus as (select distinct sku from src),
cl as (
  select k.sku, coalesce(e.category_id, r.category_id) cid, coalesce(e.subcategory_id, r.subcategory_id) sid
  from skus k left join public.commerce_sku_category_v1 e on e.sku_norm=k.sku
  left join lateral (select x.category_id, x.subcategory_id from public.commerce_sku_prefix_rules_v1 x
     where e.sku_norm is null and k.sku like x.prefix||'%' order by length(x.prefix) desc limit 1) r on true
), fd as (
  select coalesce(c.name,'Sem categoria') cat, coalesce(sc.name,'Sem subcategoria') sub, s.units, s.rev,
    case when s.sale_date between pr.cf and pr.ct then 'cur' when s.sale_date between pr.bf and pr.bt then 'base' end per,
    case when s.sale_date between greatest(pr.cf,pr.ct-27) and pr.ct then 'cur'
         when s.sale_date between greatest(pr.bf,pr.bt-27) and pr.bt then 'base' end l28
  from src s join pr on true join cl on cl.sku=s.sku
  left join public.commerce_categories c on c.id=cl.cid left join public.commerce_subcategories sc on sc.id=cl.sid
), sub_agg as (
  select cat, sub,
    coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
    coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br,
    coalesce(sum(units) filter (where l28='cur'),0) c28, coalesce(sum(units) filter (where l28='base'),0) b28
  from fd group by 1,2
), cat_agg as (
  select cat, sum(cu) cu, sum(bu) bu, sum(cr) cr, sum(br) br, sum(c28) c28, sum(b28) b28 from sub_agg group by 1
)
select jsonb_build_object(
  'platform',(select plat from pr),'year',(select y from pr),'base_year',(select b from pr),'mode',coalesce(p_mode,'ytd'),
  'as_of',(select as_of from pr),'cur_from',(select cf from pr),'cur_to',(select ct from pr),'base_from',(select bf from pr),'base_to',(select bt from pr),
  'total',(select jsonb_build_object('cur',coalesce(sum(cu),0),'base',coalesce(sum(bu),0),'cur_rev',coalesce(sum(cr),0),'base_rev',coalesce(sum(br),0),'c28',coalesce(sum(c28),0),'b28',coalesce(sum(b28),0)) from cat_agg),
  'categories',coalesce((select jsonb_agg(jsonb_build_object('name',c.cat,'cur',c.cu,'base',c.bu,'cur_rev',c.cr,'base_rev',c.br,'c28',c.c28,'b28',c.b28,
      'subs',(select jsonb_agg(jsonb_build_object('name',s.sub,'cur',s.cu,'base',s.bu,'cur_rev',s.cr,'base_rev',s.br,'c28',s.c28,'b28',s.b28) order by s.cu desc, s.sub)
              from sub_agg s where s.cat=c.cat)) order by c.cu desc, c.bu desc, c.cat) from cat_agg c where c.cu>0 or c.bu>0),'[]'::jsonb));
$f$;
revoke all on function public.commerce_categories_v2(text,int,text,int,int) from public,anon,authenticated;
grant execute on function public.commerce_categories_v2(text,int,text,int,int) to service_role;

create or replace function public.commerce_categories_sub_v2(p_platform text default 'SHOPEE', p_year int default null, p_mode text default 'ytd', p_month int default null, p_days int default null, p_cat text default null, p_sub text default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with pr as (select * from public.commerce_period_v1(p_platform,p_year,p_mode,p_month,p_days)),
src as (
  select d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units, d.product_revenue rev
    from public.commerce_shopee_sales_sku_daily_v1 d, pr
   where pr.plat in ('SHOPEE','TODAS') and (d.sale_date between pr.cf and pr.ct or d.sale_date between pr.bf and pr.bt)
  union all
  select v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units, v.product_revenue
    from public.commerce_current_sales_listing_daily_v1 v, pr
   where pr.plat <> 'SHOPEE' and v.platform_code like 'ML%' and (pr.plat='TODAS' or v.platform_code=pr.plat)
     and (v.sale_date between pr.cf and pr.ct or v.sale_date between pr.bf and pr.bt)
), skus as (select distinct sku from src),
cl as (
  select k.sku, coalesce(e.category_id, r.category_id) cid, coalesce(e.subcategory_id, r.subcategory_id) sid
  from skus k left join public.commerce_sku_category_v1 e on e.sku_norm=k.sku
  left join lateral (select x.category_id, x.subcategory_id from public.commerce_sku_prefix_rules_v1 x
     where e.sku_norm is null and k.sku like x.prefix||'%' order by length(x.prefix) desc limit 1) r on true
), fd as (
  select s.sku, s.sale_date, s.units, s.rev,
    case when s.sale_date between pr.cf and pr.ct then 'cur' when s.sale_date between pr.bf and pr.bt then 'base' end per
  from src s join pr on true join cl on cl.sku=s.sku
  left join public.commerce_categories c on c.id=cl.cid left join public.commerce_subcategories sc on sc.id=cl.sid
  where coalesce(c.name,'Sem categoria')=p_cat and coalesce(sc.name,'Sem subcategoria')=p_sub
), sk as (
  select sku, coalesce(sum(units) filter (where per='cur'),0) cu, coalesce(sum(units) filter (where per='base'),0) bu,
         coalesce(sum(rev) filter (where per='cur'),0) cr, coalesce(sum(rev) filter (where per='base'),0) br
  from fd group by 1
), rk as (
  select sk.*, sk.cu-sk.bu d,
    row_number() over (order by (sk.cu-sk.bu) desc, sk.cu desc, sk.sku) r_up,
    row_number() over (order by (sk.cu-sk.bu) asc, sk.cu desc, sk.sku) r_dn
  from sk
), pick as (select * from rk where (r_up<=5 and d>0) or (r_dn<=5 and d<0)),
links as (
  select z.sku, jsonb_agg(jsonb_build_object('platform',z.platform,'id',z.id)) links from (
    select upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) sku, m.code platform,
           (array_agg(l.external_listing_id order by (l.listing_status<>'ACTIVE'), l.id))[1] id
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where lp.platform_sku is not null and lp.relation_status<>'REMOVED'
      and upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) in (select sku from pick)
    group by 1,2) z group by z.sku
), item as (
  select p.*, 
    (select pp.name from public.commerce_product_skus ps join public.commerce_products pp on pp.id=ps.product_id
       where upper(regexp_replace(ps.sku,'[\s_]+','','g'))=p.sku limit 1) pname,
    coalesce((select k.links from links k where k.sku=p.sku),'[]'::jsonb) lk
  from pick p
), bm as (
  select to_char(sale_date,'YYYY-MM') m, sum(units) u from fd where per='cur' group by 1 order by 2 desc, 1 limit 1
)
select jsonb_build_object(
  'platform',(select plat from pr),'category',p_cat,'subcategory',p_sub,'cur_from',(select cf from pr),'cur_to',(select ct from pr),
  'best_month',(select jsonb_build_object('month',m,'units',u) from bm),
  'skus',(select count(*) from sk),
  'up',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br,'links',lk) order by r_up) from item where r_up<=5 and d>0),'[]'::jsonb),
  'down',coalesce((select jsonb_agg(jsonb_build_object('sku',sku,'name',pname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br,'links',lk) order by r_dn) from item where r_dn<=5 and d<0),'[]'::jsonb));
$f$;
revoke all on function public.commerce_categories_sub_v2(text,int,text,int,int,text,text) from public,anon,authenticated;
grant execute on function public.commerce_categories_sub_v2(text,int,text,int,int,text,text) to service_role;
