-- Cadastros por mês v2: melhor mês de venda por produto, ids dos anúncios (para os links)
-- e uma consulta de detalhe com as variações (SKU) de cada produto. Somente leitura, apenas service_role.
create or replace function public.commerce_listing_cohorts_v1(p_platform text default 'TODAS')
returns jsonb
language sql
stable
set search_path to 'public'
as $f$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML') then upper(p_platform) else 'TODAS' end plat,
         (now() at time zone 'America/Sao_Paulo')::date today
), sales as (
  select v.external_listing_id, v.sale_date, v.units, v.product_revenue
  from public.commerce_current_sales_listing_daily_v1 v, params p where v.sale_date < p.today
), lastday as (select max(sale_date) d from sales),
prod as (
  select c.platform, c.product_ref, min(c.created_on) created_on, (array_agg(c.title order by c.created_on, c.external_listing_id))[1] title,
         count(*) items, jsonb_agg(c.external_listing_id order by c.external_listing_id) listing_ids
  from public.commerce_listing_creation_v1 c, params p
  where p.plat='TODAS' or c.platform=p.plat
  group by c.platform, c.product_ref
), agg as (
  select pr.platform, pr.product_ref, pr.title, pr.created_on, pr.items, pr.listing_ids,
    (select d from lastday) - pr.created_on + 1 age_days,
    coalesce(sum(s.units),0) units, coalesce(sum(s.product_revenue),0) revenue,
    min(s.sale_date) first_sale,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 7),0) u7,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 14),0) u14,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 28),0) u28,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 56),0) u56,
    coalesce(sum(s.units) filter (where s.sale_date > (select d from lastday) - 28),0) u_last28
  from prod pr
  left join public.commerce_listing_creation_v1 ci on ci.platform=pr.platform and ci.product_ref=pr.product_ref
  left join sales s on s.external_listing_id=ci.external_listing_id
  group by pr.platform, pr.product_ref, pr.title, pr.created_on, pr.items, pr.listing_ids
), pm as (
  select ci.platform, ci.product_ref, date_trunc('month',s.sale_date)::date mth, sum(s.units) u
  from public.commerce_listing_creation_v1 ci join sales s on s.external_listing_id=ci.external_listing_id
  group by 1,2,3
), best as (
  select distinct on (platform, product_ref) platform, product_ref, mth, u from pm order by platform, product_ref, u desc, mth
)
select jsonb_build_object(
  'platform',(select plat from params),
  'last_day',(select d from lastday),
  'months',coalesce((select jsonb_agg(m order by m->>'month') from (
    select jsonb_build_object('month',date_trunc('month',a.created_on)::date,
      'products',count(*),'units',sum(a.units),'revenue',round(sum(a.revenue),2),
      'items',jsonb_agg(jsonb_build_object(
        'platform',a.platform,'product_ref',a.product_ref,'title',a.title,'created_on',a.created_on,'age_days',a.age_days,'listings',a.items,
        'listing_ids',a.listing_ids,
        'units',a.units,'revenue',round(a.revenue,2),
        'days_to_first_sale',case when a.first_sale is null then null else a.first_sale-a.created_on end,
        'u7',case when a.age_days>=7 then a.u7 end,'u14',case when a.age_days>=14 then a.u14 end,
        'u28',case when a.age_days>=28 then a.u28 end,'u56',case when a.age_days>=56 then a.u56 end,
        'u_last28',a.u_last28,'best_month',b.mth,'best_month_units',b.u) order by a.created_on, a.units desc)) m
    from agg a left join best b on b.platform=a.platform and b.product_ref=a.product_ref
    group by date_trunc('month',a.created_on)) t),'[]'::jsonb));
$f$;
revoke all on function public.commerce_listing_cohorts_v1(text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohorts_v1(text) to service_role;

create or replace function public.commerce_listing_cohort_detail_v1(p_platform text, p_product_ref text)
returns jsonb
language sql
stable
set search_path to 'public'
as $f$
with params as (
  select case when upper(coalesce(p_platform,''))='ML' then 'ML' else 'SHOPEE' end plat,
         (now() at time zone 'America/Sao_Paulo')::date today, btrim(coalesce(p_product_ref,'')) ref
), items as (
  select c.external_listing_id, c.created_on, c.title from public.commerce_listing_creation_v1 c, params p
  where c.platform=p.plat and c.product_ref=p.ref
), sales as (
  select v.external_listing_id, v.sku_norm sku, v.sale_date, v.units, v.product_revenue
  from public.commerce_current_sales_listing_daily_v1 v join items i on i.external_listing_id=v.external_listing_id, params p
  where v.sale_date < p.today
), lastday as (select max(sale_date) d from public.commerce_current_sales_listing_daily_v1, params where sale_date < params.today),
lst as (
  select i.external_listing_id id, coalesce(sum(s.units),0) units, coalesce(sum(s.product_revenue),0) revenue, min(s.sale_date) first_sale
  from items i left join sales s on s.external_listing_id=i.external_listing_id group by i.external_listing_id
), lm as (select external_listing_id id, date_trunc('month',sale_date)::date mth, sum(units) u from sales group by 1,2),
lbest as (select distinct on (id) id, mth, u from lm order by id, u desc, mth),
vnames as (
  -- as vendas guardam o SKU normalizado (só letras e números); o cadastro guarda o SKU com underscores
  select regexp_replace(upper(lp.platform_sku),'[^A-Z0-9]','','g') sku, min(lp.platform_sku) sku_show,
         (array_agg(nullif(btrim(lp.variation_name),'') order by lp.variation_name) filter (where nullif(btrim(lp.variation_name),'') is not null))[1] name
  from public.commerce_listing_products lp join public.commerce_listings l on l.id=lp.listing_id join items i on i.external_listing_id=l.external_listing_id
  where lp.platform_sku is not null group by 1
), skus as (select sku from vnames union select sku from sales),
vt as (select s.sku, sum(s.units) units, sum(s.product_revenue) revenue, min(s.sale_date) first_sale,
        coalesce(sum(s.units) filter (where s.sale_date > (select d from lastday) - 28),0) u28 from sales s group by s.sku),
vm as (select sku, date_trunc('month',sale_date)::date mth, sum(units) u from sales group by 1,2),
vbest as (select distinct on (sku) sku, mth, u from vm order by sku, u desc, mth),
pmn as (select date_trunc('month',sale_date)::date mth, sum(units) u, sum(product_revenue) revenue from sales group by 1)
select jsonb_build_object(
  'product_ref',(select ref from params),'platform',(select plat from params),
  'title',(select title from items order by created_on, external_listing_id limit 1),
  'created_on',(select min(created_on) from items),'last_day',(select d from lastday),
  'months',coalesce((select jsonb_agg(jsonb_build_object('month',mth,'units',u,'revenue',round(revenue,2)) order by mth) from pmn),'[]'::jsonb),
  'listings',coalesce((select jsonb_agg(jsonb_build_object('external_id',l.id,'units',l.units,'revenue',round(l.revenue,2),'first_sale',l.first_sale,
      'best_month',b.mth,'best_month_units',b.u) order by l.units desc, l.id) from lst l left join lbest b on b.id=l.id),'[]'::jsonb),
  'variations',coalesce((select jsonb_agg(jsonb_build_object('sku',coalesce(n.sku_show,k.sku),'name',n.name,'units',coalesce(t.units,0),'revenue',round(coalesce(t.revenue,0),2),
      'first_sale',t.first_sale,'u_last28',coalesce(t.u28,0),'best_month',b.mth,'best_month_units',b.u,
      'months',coalesce((select jsonb_agg(jsonb_build_object('month',m.mth,'units',m.u) order by m.mth) from vm m where m.sku=k.sku),'[]'::jsonb))
      order by coalesce(t.units,0) desc, k.sku)
    from skus k left join vnames n on n.sku=k.sku left join vt t on t.sku=k.sku left join vbest b on b.sku=k.sku),'[]'::jsonb));
$f$;
revoke all on function public.commerce_listing_cohort_detail_v1(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohort_detail_v1(text,text) to service_role;
