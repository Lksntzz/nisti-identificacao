-- "Novo" de verdade: informa, para cada produto das listas anuais, quantas unidades ele vendeu no ANO BASE INTEIRO ("prior": {"y": n}).
-- Campo aditivo; nenhum total ou lista existente muda. A tela usa "y" para separar "novo" (nunca vendeu no ano base) de "já vendia" (vendeu em outro mês).
-- O mapa é calculado uma única vez por consulta (uma varredura do ano base), não uma vez por produto.
create or replace function public.commerce_sku_prior_map_v1(p_platform text, p_base int) returns jsonb
language sql stable set search_path to 'public' as $f$
with prm as (
  select case when upper(coalesce(p_platform,'SHOPEE')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         make_date(p_base,1,1) d0, make_date(p_base+1,1,1) d1
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
)
select coalesce(jsonb_object_agg(sku, u), '{}'::jsonb) from agg;
$f$;
revoke all on function public.commerce_sku_prior_map_v1(text,int) from public,anon,authenticated;
grant execute on function public.commerce_sku_prior_map_v1(text,int) to service_role;

-- Acrescenta "prior" em cada produto das três consultas (patch via pg_get_functiondef + replace, como nas migrações anteriores).
do $do$
declare oid_ oid; def text; nd text;
begin
  select p.oid into oid_ from pg_proc p where p.proname='commerce_annual_month_v1' and p.pronamespace='public'::regnamespace;
  def := pg_get_functiondef(oid_);
  if position('commerce_sku_prior_map_v1' in def)=0 then
    nd := replace(def, $a$'links',coalesce((select k.links from skulinks k where k.sku=skr.sku)$a$,
      $b$'prior',jsonb_build_object('y',coalesce(((select public.commerce_sku_prior_map_v1((select plat from cut),(select b from cut)))->>skr.sku)::bigint,0)),'links',coalesce((select k.links from skulinks k where k.sku=skr.sku)$b$);
    if nd=def then raise exception 'padrao nao encontrado em commerce_annual_month_v1'; end if;
    execute nd;
  end if;

  select p.oid into oid_ from pg_proc p where p.proname='commerce_annual_period_products_v1' and p.pronamespace='public'::regnamespace;
  def := pg_get_functiondef(oid_);
  if position('commerce_sku_prior_map_v1' in def)=0 then
    nd := replace(def, $a$'links',coalesce((select k.links from links k where k.sku=r.sku)$a$,
      $b$'prior',jsonb_build_object('y',coalesce(((select public.commerce_sku_prior_map_v1((select plat from prm),(select extract(year from bf)::int from prm)))->>r.sku)::bigint,0)),'links',coalesce((select k.links from links k where k.sku=r.sku)$b$);
    if nd=def then raise exception 'padrao nao encontrado em commerce_annual_period_products_v1'; end if;
    execute nd;
  end if;

  select p.oid into oid_ from pg_proc p where p.proname='commerce_annual_day_products_v1' and p.pronamespace='public'::regnamespace;
  def := pg_get_functiondef(oid_);
  if position('commerce_sku_prior_map_v1' in def)=0 then
    nd := replace(def, $a$'links',coalesce((select k.links from links k where k.sku=r.sku)$a$,
      $b$'prior',jsonb_build_object('y',coalesce(((select public.commerce_sku_prior_map_v1((select plat from prm),(select extract(year from b)::int from prm)))->>r.sku)::bigint,0)),'links',coalesce((select k.links from links k where k.sku=r.sku)$b$);
    if nd=def then raise exception 'padrao nao encontrado em commerce_annual_day_products_v1'; end if;
    execute nd;
  end if;
end $do$;
