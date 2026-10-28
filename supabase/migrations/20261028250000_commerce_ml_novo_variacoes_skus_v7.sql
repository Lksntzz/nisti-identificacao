-- ML Novo: variações = SKUs cadastrados do anúncio (mesmo sem venda, em cinza) + vendas dos que venderam.
create table if not exists public.commerce_listing_variation_skus_v1 (
  platform text not null default 'ML',
  external_listing_id text not null,
  sku text not null,
  created_at timestamptz not null default now(),
  primary key (platform, external_listing_id, sku)
);
alter table public.commerce_listing_variation_skus_v1 enable row level security;
revoke all on public.commerce_listing_variation_skus_v1 from public,anon,authenticated;
grant all on public.commerce_listing_variation_skus_v1 to service_role;
insert into public.commerce_listing_variation_skus_v1(platform,external_listing_id,sku) values
('ML','MLB7381293540','VACMNA_JAFE1_BBB'),('ML','MLB7381293540','VACMNA_JAFE2_BRR'),('ML','MLB7381293540','VACMNA_JAFE3_BLL'),('ML','MLB7381293540','VACMNA_JAFE4_BBB'),('ML','MLB7381293540','VACMNA_JAFE5_BBB'),
('ML','MLB7412780970','VACMNO_MLVS_BAA')
on conflict do nothing;
create or replace function public.commerce_listing_cohort_detail_v7(p_platform text, p_key text)
returns jsonb language sql stable set search_path to 'public' as $g$
with d as (select public.commerce_listing_cohort_detail_v6(p_platform,p_key) j),
ids as (select l->>'external_id' id from d, jsonb_array_elements(d.j->'listings') l),
have as (select regexp_replace(upper(v->>'sku'),'[^A-Z0-9]','','g') n from d, jsonb_array_elements(d.j->'variations') v),
extra as (
  select s.sku, s.external_listing_id from public.commerce_listing_variation_skus_v1 s join ids on ids.id=s.external_listing_id
  where s.platform='ML' and regexp_replace(upper(s.sku),'[^A-Z0-9]','','g') not in (select n from have))
select case when upper(coalesce(p_platform,''))<>'ML' or split_part(coalesce(p_key,''),'|',2)<>'NOVO' then (select j from d)
 else jsonb_set((select j from d),'{variations}',
   coalesce((select jsonb_agg(v order by (v->>'units')::numeric desc, v->>'sku') from (
      select v from d, jsonb_array_elements(d.j->'variations') v
      union all
      select jsonb_build_object('sku',e.sku,'name',e.sku,'listing_id',e.external_listing_id,'units',0,'revenue',0,'u_last28',0,'best_month',null,'best_month_units',null) from extra e) t(v)),'[]'::jsonb)) end;
$g$;
revoke all on function public.commerce_listing_cohort_detail_v7(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohort_detail_v7(text,text) to service_role;

create or replace function public.commerce_listing_cohorts_v5(p_platform text default 'TODAS', p_account text default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with base as (select public.commerce_listing_cohorts_v4(p_platform,p_account) j)
select jsonb_set(b.j,'{months}',coalesce((select jsonb_agg(jsonb_set(m,'{items}',coalesce((
  select jsonb_agg(case when it->>'account'='NOVO' then it || jsonb_build_object('skus',(
     select count(distinct n) from (
       select regexp_replace(upper(s.sku),'[^A-Z0-9]','','g') n from public.commerce_listing_variation_skus_v1 s where s.platform='ML' and s.external_listing_id in (select jsonb_array_elements_text(it->'listing_ids'))
       union
       select v.sku_norm from public.commerce_current_sales_listing_daily_v1 v where v.external_listing_id in (select jsonb_array_elements_text(it->'listing_ids')) and v.sku_norm is not null) q))
     else it end order by o) from jsonb_array_elements(m->'items') with ordinality t(it,o)),'[]'::jsonb)) order by m->>'month') from jsonb_array_elements(b.j->'months') m),'[]'::jsonb))
from base b;
$f$;
revoke all on function public.commerce_listing_cohorts_v5(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohorts_v5(text,text) to service_role;

-- Correção de dados: o anúncio "Menino Personalizado Atualizado" (MLBU4680009624) agrupa os MLB 5033568041 e 7412780970; Jardim de Afetos = MLB7381293540.
update public.commerce_listing_creation_v1 set product_ref='NOVO-0001', title='Caderneta De Vacinação Menino Personalizado Atualizado', updated_at=now() where platform='ML' and external_listing_id in ('MLB5033568041','MLB7412780970');
update public.commerce_listing_creation_v1 set product_ref='NOVO-0002' where platform='ML' and external_listing_id='MLB7381293540';
