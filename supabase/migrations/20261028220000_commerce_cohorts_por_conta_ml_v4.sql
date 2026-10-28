-- Cadastros por mês: ML Antigo e ML Novo separados (filtro por conta; um produto nunca junta anúncios de contas diferentes).
create or replace function public.commerce_listing_cohorts_v4(p_platform text default 'TODAS', p_account text default null)
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
  select c.*, coalesce(l.account_code,'') account, case when c.platform='ML' then c.product_ref||'|'||coalesce(l.account_code,'') else c.external_listing_id end k
  from public.commerce_listing_creation_v1 c
  left join public.commerce_listings l on l.external_listing_id=c.external_listing_id, params p
  where (p.plat='TODAS' or c.platform=p.plat)
    and (upper(coalesce(p_account,''))='' or (c.platform='ML' and upper(coalesce(l.account_code,''))=upper(p_account)))
), prod as (
  select k.platform, min(k.product_ref) product_ref, min(k.account) account, k.k lid, min(k.created_on) created_on,
         (array_agg(k.title order by k.created_on, k.external_listing_id))[1] title,
         count(*) items, jsonb_agg(k.external_listing_id order by k.external_listing_id) listing_ids
  from keyed k group by k.platform, k.k
), agg as (
  select pr.platform, pr.product_ref, pr.account, pr.lid, pr.title, pr.created_on, pr.items, pr.listing_ids,
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
  group by pr.platform, pr.product_ref, pr.account, pr.lid, pr.title, pr.created_on, pr.items, pr.listing_ids
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
        'platform',a.platform,'product_ref',a.product_ref,'account',a.account,'listing_id',a.lid,'title',a.title,'created_on',a.created_on,'age_days',a.age_days,'listings',a.items,
        'listing_ids',a.listing_ids,
        'units',a.units,'revenue',round(a.revenue,2),
        'days_to_first_sale',case when a.first_sale is null then null else a.first_sale-a.created_on end,
        'u7',case when a.age_days>=7 then a.u7 end,'u14',case when a.age_days>=14 then a.u14 end,
        'u28',case when a.age_days>=28 then a.u28 end,'u56',case when a.age_days>=56 then a.u56 end,
        'u_last28',a.u_last28,'best_month',b.mth,'best_month_units',b.u) order by a.created_on, a.units desc, a.lid)) m
    from agg a left join best b on b.lid=a.lid
    group by date_trunc('month',a.created_on)) t),'[]'::jsonb));
$f$;
revoke all on function public.commerce_listing_cohorts_v4(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohorts_v4(text,text) to service_role;

-- Detalhe ML: a chave do anúncio é "PROD-xxxx|CONTA"; só entram os MLB dessa conta.
create or replace function public.commerce_listing_cohort_detail_v5(p_platform text, p_key text)
returns jsonb
language sql
stable
set search_path to 'public'
as $g$
with k as (select split_part(coalesce(p_key,''),'|',1) ref, nullif(split_part(coalesce(p_key,''),'|',2),'') acct),
d as (select public.commerce_listing_cohort_detail_v4(p_platform,(select ref from k)) j)
select case when upper(coalesce(p_platform,''))<>'ML' or (select acct from k) is null then (select j from d)
  else (
    with ok as (select l.external_listing_id id from public.commerce_listings l where upper(coalesce(l.account_code,''))=upper((select acct from k)))
    select jsonb_set(jsonb_set(jsonb_set(d.j,'{variations}',coalesce((select jsonb_agg(v) from jsonb_array_elements(d.j->'variations') v where v->>'listing_id' in (select id from ok)),'[]'::jsonb)),
      '{listings}',coalesce((select jsonb_agg(l) from jsonb_array_elements(d.j->'listings') l where l->>'external_id' in (select id from ok)),'[]'::jsonb)),
      '{months}',coalesce((select jsonb_agg(jsonb_build_object('month',mth,'units',u,'revenue',r) order by mth)
        from (select m->>'month' mth, sum((m->>'units')::numeric) u, sum((m->>'revenue')::numeric) r
              from jsonb_array_elements(d.j->'listings') l, jsonb_array_elements(l->'months') m
              where l->>'external_id' in (select id from ok) group by 1) t),'[]'::jsonb))
    from d) end;
$g$;
revoke all on function public.commerce_listing_cohort_detail_v5(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohort_detail_v5(text,text) to service_role;
