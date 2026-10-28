-- Cadastros por mês: UMA linha por anúncio (nunca mistura vendas nem variações de anúncios diferentes), mesmo com o mesmo SKU/dia de cadastro.
create or replace function public.commerce_listing_cohorts_v2(p_platform text default 'TODAS')
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
  select c.platform, c.product_ref, c.external_listing_id lid, c.created_on, c.title,
         1 items, jsonb_build_array(c.external_listing_id) listing_ids
  from public.commerce_listing_creation_v1 c, params p
  where p.plat='TODAS' or c.platform=p.plat
), agg as (
  select pr.platform, pr.product_ref, pr.lid, pr.title, pr.created_on, pr.items, pr.listing_ids,
    (select d from lastday) - pr.created_on + 1 age_days,
    coalesce(sum(s.units),0) units, coalesce(sum(s.product_revenue),0) revenue,
    min(s.sale_date) first_sale,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 7),0) u7,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 14),0) u14,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 28),0) u28,
    coalesce(sum(s.units) filter (where s.sale_date < pr.created_on + 56),0) u56,
    coalesce(sum(s.units) filter (where s.sale_date > (select d from lastday) - 28),0) u_last28
  from prod pr
  left join sales s on s.external_listing_id=pr.lid
  group by pr.platform, pr.product_ref, pr.lid, pr.title, pr.created_on, pr.items, pr.listing_ids
), pm as (
  select s.external_listing_id lid, date_trunc('month',s.sale_date)::date mth, sum(s.units) u
  from sales s group by 1,2
), best as (
  select distinct on (lid) lid, mth, u from pm order by lid, u desc, mth
)
select jsonb_build_object(
  'platform',(select plat from params),
  'last_day',(select d from lastday),
  'months',coalesce((select jsonb_agg(m order by m->>'month') from (
    select jsonb_build_object('month',date_trunc('month',a.created_on)::date,
      'products',count(*),'units',sum(a.units),'revenue',round(sum(a.revenue),2),
      'items',jsonb_agg(jsonb_build_object(
        'platform',a.platform,'product_ref',a.product_ref,'listing_id',a.lid,'title',a.title,'created_on',a.created_on,'age_days',a.age_days,'listings',a.items,
        'listing_ids',a.listing_ids,
        'units',a.units,'revenue',round(a.revenue,2),
        'days_to_first_sale',case when a.first_sale is null then null else a.first_sale-a.created_on end,
        'u7',case when a.age_days>=7 then a.u7 end,'u14',case when a.age_days>=14 then a.u14 end,
        'u28',case when a.age_days>=28 then a.u28 end,'u56',case when a.age_days>=56 then a.u56 end,
        'u_last28',a.u_last28,'best_month',b.mth,'best_month_units',b.u) order by a.created_on, a.units desc, a.lid)) m
    from agg a left join best b on b.lid=a.lid
    group by date_trunc('month',a.created_on)) t),'[]'::jsonb));
$f$;
revoke all on function public.commerce_listing_cohorts_v2(text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohorts_v2(text) to service_role;

-- Detalhe de UM anúncio (não do produto): meses e variações só desse anúncio.
create or replace function public.commerce_listing_cohort_detail_v3(p_platform text, p_listing_id text)
returns jsonb
language sql
stable
set search_path to 'public'
as $g$
with c as (
  select * from public.commerce_listing_creation_v1
  where platform=case when upper(coalesce(p_platform,''))='ML' then 'ML' else 'SHOPEE' end and external_listing_id=btrim(coalesce(p_listing_id,'')) limit 1
), d as (select public.commerce_listing_cohort_detail_v2(c.platform,c.product_ref) j, c.* from c),
l as (select d.*, x l from d, jsonb_array_elements(d.j->'listings') x where x->>'external_id'=d.external_listing_id)
select jsonb_build_object('product_ref',product_ref,'platform',platform,'listing_id',external_listing_id,'title',title,'created_on',created_on,
  'last_day',j->'last_day','months',l->'months','listings',jsonb_build_array(l-'months'-'variations'),'variations',l->'variations')
from l;
$g$;
revoke all on function public.commerce_listing_cohort_detail_v3(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohort_detail_v3(text,text) to service_role;
