-- "Novo" passa a considerar o NÚMERO DO ANÚNCIO: um SKU conta como "já existia" se ele vendeu no ano base
-- OU se algum anúncio que vendeu esse SKU no ano atual já tinha vendas no ano base (troca de SKU em anúncio antigo).
-- Mesma assinatura e mesmo formato de retorno (mapa sku -> unidades); só passa a incluir também o histórico por anúncio.
create or replace function public.commerce_sku_prior_map_v1(p_platform text, p_base int) returns jsonb
language sql stable set search_path to 'public' as $f$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         make_date(p_base,1,1) d0, make_date(p_base+1,1,1) d1, make_date(p_base+2,1,1) d2
), src as (
  select 'SHOPEE'::text plat, d.sku_norm, d.units
    from public.commerce_shopee_sales_sku_daily_v1 d, prm where d.sale_date >= prm.d0 and d.sale_date < prm.d1
  union all
  select v.platform_code, v.sku_norm, v.units
    from public.commerce_current_sales_listing_daily_v1 v, prm
   where v.platform_code like 'ML%' and upper(coalesce(p_platform,'SHOPEE')) <> 'SHOPEE' and v.sale_date >= prm.d0 and v.sale_date < prm.d1
), agg as (
  select public.commerce_sku_canon_v1(s.sku_norm) sku, sum(s.units) u
    from src s, prm where prm.plat='TODAS' or s.plat=prm.plat group by 1
), lst as (
  select v.platform_code plat, v.external_listing_id id, v.sku_norm, v.units, v.sale_date, prm.d1
    from public.commerce_current_sales_listing_daily_v1 v, prm
   where v.sale_date >= prm.d0 and v.sale_date < prm.d2 and (prm.plat='TODAS' or v.platform_code=prm.plat)
), base_l as (select plat, id, sum(units) u from lst where sale_date < d1 group by 1,2),
cur_l as (select distinct plat, id, public.commerce_sku_canon_v1(sku_norm) sku from lst where sale_date >= d1),
alias as (select c.sku, sum(b.u) u from cur_l c join base_l b on b.plat=c.plat and b.id=c.id group by 1),
fin as (
  select coalesce(a.sku, l.sku) sku, greatest(coalesce(a.u,0), coalesce(l.u,0)) u
  from agg a full join alias l on l.sku=a.sku
)
select coalesce(jsonb_object_agg(sku, u), '{}'::jsonb) from fin where u > 0;
$f$;
