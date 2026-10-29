-- Produtos vendidos em um dia (data atual x data equivalente do ano anterior) + links dos anúncios por SKU nos produtos do mês.
create or replace function public.commerce_annual_day_products_v1(p_platform text default 'SHOPEE', p_cur date default null, p_base date default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat, p_cur c, p_base b
  where p_cur is not null and p_base is not null
), src as (
  select 'SHOPEE'::text plat, d.sale_date, public.commerce_sku_canon_v1(d.sku_norm) sku, d.units
    from public.commerce_shopee_sales_sku_daily_v1 d, prm where d.sale_date in (prm.c, prm.b)
  union all
  select v.platform_code, v.sale_date, public.commerce_sku_canon_v1(v.sku_norm), v.units
    from public.commerce_current_sales_listing_daily_v1 v, prm
   where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE' and v.sale_date in (prm.c, prm.b)
), agg as (
  select s.sku,
    coalesce(sum(s.units) filter (where s.sale_date=prm.c),0) cu,
    coalesce(sum(s.units) filter (where s.sale_date=prm.b),0) bu
  from src s, prm where prm.plat='TODAS' or s.plat=prm.plat group by s.sku
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
  select a.*, row_number() over (order by a.cu desc, a.bu desc, a.sku) r from agg a where a.cu>0 or a.bu>0
)
select jsonb_build_object(
  'platform',(select plat from prm),'cur_date',(select c from prm),'base_date',(select b from prm),
  'total',jsonb_build_object('cur',coalesce((select sum(cu) from agg),0),'base',coalesce((select sum(bu) from agg),0)),
  'products',coalesce((select jsonb_agg(jsonb_build_object('sku',r.sku,'cur',r.cu,'base',r.bu,
      'name',(select pp.name from public.commerce_product_skus ps join public.commerce_products pp on pp.id=ps.product_id
              where upper(regexp_replace(ps.sku,'[\s_]+','','g'))=r.sku limit 1),
      'category',(select c.name from public.commerce_sku_category_v1 e join public.commerce_categories c on c.id=e.category_id where e.sku_norm=r.sku limit 1),
      'links',coalesce((select k.links from links k where k.sku=r.sku),'[]'::jsonb)) order by r.r) from ranked r where r.r<=40),'[]'::jsonb));
$f$;
revoke all on function public.commerce_annual_day_products_v1(text,date,date) from public,anon,authenticated;
grant execute on function public.commerce_annual_day_products_v1(text,date,date) to service_role;

-- Links dos anúncios (Shopee / Mercado Livre) nos produtos do mês.
do $do$
declare oid_ oid; def text;
begin
  select p.oid into oid_ from pg_proc p where p.proname='commerce_annual_month_v1' and p.pronamespace='public'::regnamespace;
  def := pg_get_functiondef(oid_);
  if position('), skr as (' in def)=0 then raise exception 'padrao nao encontrado'; end if;
  def := replace(def, '), skr as (', $x$), skulinks as (
  select z.sku, jsonb_agg(jsonb_build_object('platform',z.platform,'id',z.id)) links from (
    select upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) sku, m.code platform,
           (array_agg(l.external_listing_id order by (l.listing_status<>'ACTIVE'), l.id))[1] id
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where lp.platform_sku is not null and lp.relation_status<>'REMOVED'
      and upper(regexp_replace(lp.platform_sku,'[\s_]+','','g')) in (select sku from skus)
    group by 1,2) z group by z.sku
), skr as ($x$);
  def := replace(def, $y$'category',cname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br)$y$, $y$'category',cname,'cur',cu,'base',bu,'cur_rev',cr,'base_rev',br,'links',coalesce((select k.links from skulinks k where k.sku=skr.sku),'[]'::jsonb))$y$);
  def := replace(def, $y$'category',cname,'cur',cu,'base',bu) order by r_up$y$, $y$'category',cname,'cur',cu,'base',bu,'links',coalesce((select k.links from skulinks k where k.sku=skr.sku),'[]'::jsonb)) order by r_up$y$);
  def := replace(def, $y$'category',cname,'cur',cu,'base',bu) order by r_dn$y$, $y$'category',cname,'cur',cu,'base',bu,'links',coalesce((select k.links from skulinks k where k.sku=skr.sku),'[]'::jsonb)) order by r_dn$y$);
  execute def;
end $do$;
