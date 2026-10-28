-- Cadastros por mês: anúncio = linha; as variações ficam DENTRO do anúncio (Shopee: variações do anúncio; ML: cada MLB é uma variação do produto).
create or replace function public.commerce_listing_cohorts_v3(p_platform text default 'TODAS')
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
keyed as (
  -- Shopee: cada anúncio é uma linha. Mercado Livre: cada MLB é uma arte/variação; o anúncio é o produto (todas as MLB dele juntas).
  select c.*, case when c.platform='ML' then c.product_ref else c.external_listing_id end k
  from public.commerce_listing_creation_v1 c, params p
  where p.plat='TODAS' or c.platform=p.plat
), prod as (
  select k.platform, min(k.product_ref) product_ref, k.k lid, min(k.created_on) created_on,
         (array_agg(k.title order by k.created_on, k.external_listing_id))[1] title,
         count(*) items, jsonb_agg(k.external_listing_id order by k.external_listing_id) listing_ids
  from keyed k group by k.platform, k.k
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
  left join keyed kk on kk.platform=pr.platform and kk.k=pr.lid
  left join sales s on s.external_listing_id=kk.external_listing_id
  group by pr.platform, pr.product_ref, pr.lid, pr.title, pr.created_on, pr.items, pr.listing_ids
), pm as (
  select kk.k lid, date_trunc('month',s.sale_date)::date mth, sum(s.units) u
  from keyed kk join sales s on s.external_listing_id=kk.external_listing_id group by 1,2
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
revoke all on function public.commerce_listing_cohorts_v3(text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohorts_v3(text) to service_role;

-- Detalhe: Shopee = um anúncio; Mercado Livre = o produto, com cada MLB como uma variação.
create or replace function public.commerce_listing_cohort_detail_v4(p_platform text, p_key text)
returns jsonb
language sql
stable
set search_path to 'public'
as $g$
select case when upper(coalesce(p_platform,''))='ML' then (
  with j as (select public.commerce_listing_cohort_detail_v2('ML',p_key) j)
  select jsonb_set(j.j,'{variations}',coalesce((select jsonb_agg(jsonb_build_object(
      'sku',coalesce(l->'variations'->0->>'sku',l->>'external_id'),
      'name',coalesce(nullif(l->'variations'->0->>'name',''),l->>'external_id'),
      'listing_id',l->>'external_id',
      'units',(l->>'units')::numeric,'revenue',(l->>'revenue')::numeric,
      'u_last28',coalesce((select sum((v->>'u_last28')::numeric) from jsonb_array_elements(l->'variations') v),0),
      'best_month',l->'best_month','best_month_units',l->'best_month_units',
      'months',l->'months') order by (l->>'units')::numeric desc, l->>'external_id')
    from jsonb_array_elements(j.j->'listings') l),'[]'::jsonb))
  from j)
else public.commerce_listing_cohort_detail_v3('SHOPEE',p_key) end;
$g$;
revoke all on function public.commerce_listing_cohort_detail_v4(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohort_detail_v4(text,text) to service_role;
