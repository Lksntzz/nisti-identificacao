-- Curva ABC do Painel Comercial: por SKU (item), no período escolhido,
-- por plataforma ou global (TODAS = Shopee + ML Antigo + ML Novo). Somente leitura.
-- Shopee usa as vendas diárias por SKU (cada venda no seu próprio SKU, já com SKUs de anos
-- diferentes unificados). Mercado Livre só tem venda por anúncio: usa o SKU do anúncio.
create or replace function public.commerce_dashboard_abc_v2(
  p_platform text default 'TODAS', p_start date default null, p_end date default null)
returns jsonb language sql stable set search_path to 'public' as $fn$
with prm as (
  select upper(coalesce(p_platform,'TODAS')) plat from (select 1) x
  where upper(coalesce(p_platform,'TODAS')) in ('TODAS','SHOPEE','ML_ANTIGO','ML_NOVO')
), src as (
  select 'SHOPEE'::text platform_code,
    coalesce(nullif(public.commerce_sku_canon_v1(nullif(btrim(d.sku_norm),'')),''),'SEM SKU') key,
    d.units::numeric units, d.product_revenue::numeric revenue
  from public.commerce_shopee_sales_sku_daily_v1 d cross join prm
  where prm.plat in ('TODAS','SHOPEE')
    and (p_start is null or d.sale_date>=p_start) and (p_end is null or d.sale_date<=p_end)
  union all
  select v.platform_code,
    coalesce(nullif(public.commerce_sku_canon_v1(nullif(btrim(v.sku_norm),'')),''),'ANÚNCIO '||v.external_listing_id),
    v.units::numeric, v.product_revenue::numeric
  from public.commerce_current_sales_listing_daily_v1 v cross join prm
  where v.platform_code like 'ML%' and (prm.plat='TODAS' or v.platform_code=prm.plat)
    and (p_start is null or v.sale_date>=p_start) and (p_end is null or v.sale_date<=p_end)
), prod as (
  select key,sum(units) units,sum(revenue) revenue from src group by 1 having sum(revenue)>0
), ranked as (
  select p.*,sum(revenue) over (order by revenue desc,key rows between unbounded preceding and 1 preceding) before_rev,
    sum(revenue) over () total_rev from prod p
), abc as (
  select r.*,case when coalesce(before_rev,0)<0.80*total_rev then 'A'
    when coalesce(before_rev,0)<0.95*total_rev then 'B' else 'C' end cls from ranked r
), cls as (
  select cls,count(*) products,sum(units) units,sum(revenue) revenue,
    sum(revenue)/nullif(sum(sum(revenue)) over (),0)*100 pct from abc group by 1
), top as (
  select * from abc order by revenue desc,key limit 120
), lk as (
  select t.key,l.platform_code,l.external_listing_id,sum(l.units) units,sum(l.product_revenue) revenue
  from public.commerce_current_sales_listing_daily_v1 l cross join prm
  join top t on t.key=coalesce(nullif(public.commerce_sku_canon_v1(nullif(btrim(l.sku_norm),'')),''),'ANÚNCIO '||l.external_listing_id)
  where (prm.plat='TODAS' or l.platform_code=prm.plat)
    and (p_start is null or l.sale_date>=p_start) and (p_end is null or l.sale_date<=p_end)
  group by 1,2,3 having sum(l.product_revenue)>0
)
select jsonb_build_object(
  'platform',(select plat from prm),'start',p_start,'end',p_end,
  'classes',coalesce((select jsonb_agg(jsonb_build_object('class',cls,'products',products,'units',units,
     'revenue',round(revenue,2),'revenue_pct',round(pct,1)) order by cls) from cls),'[]'::jsonb),
  'items',coalesce((select jsonb_agg(jsonb_build_object('platform',(select plat from prm),'key',t.key,'class',t.cls,
     'title',coalesce(nullif(public.commerce_sku_name_v1(t.key),''),
       (select li.title from public.commerce_listings li where 'ANÚNCIO '||li.external_listing_id=t.key limit 1)),
     'units',t.units,'revenue',round(t.revenue,2),
     'listings',(select count(*) from lk where lk.key=t.key),
     'links',coalesce((select jsonb_agg(jsonb_build_object('platform',lk.platform_code,'external_id',lk.external_listing_id,
        'units',lk.units,'revenue',round(lk.revenue,2)) order by lk.revenue desc) from lk where lk.key=t.key),'[]'::jsonb),
     'cum_pct',round((coalesce(t.before_rev,0)+t.revenue)/t.total_rev*100,1)) order by t.revenue desc,t.key) from top t),'[]'::jsonb));
$fn$;
revoke all on function public.commerce_dashboard_abc_v2(text,date,date) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_abc_v2(text,date,date) to service_role;
