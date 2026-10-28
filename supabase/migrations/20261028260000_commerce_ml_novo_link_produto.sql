-- ML Novo: o link do anúncio abre a página do produto (MLBU) guardada em source_url; cohorts_v5 devolve product_url.
update public.commerce_listings set source_url='https://www.mercadolivre.com.br/caderneta-de-vacinacao-menino-personalizado-atualizado/up/MLBU4680009624' where external_listing_id in ('MLB5033568041','MLB7412780970');
update public.commerce_listings set source_url='https://www.mercadolivre.com.br/caderneta-de-vacinacao-menina-personalizado-jardim-de-afetos/up/MLBU4682135514' where external_listing_id='MLB7381293540';
-- Anúncio provisório do Menino Capa Dura (ainda sem código MLB): ver commerce_listings external_listing_id MLBU4934091966.
create or replace function public.commerce_listing_cohorts_v5(p_platform text default 'TODAS', p_account text default null)
returns jsonb language sql stable set search_path to 'public' as $f$
with base as (select public.commerce_listing_cohorts_v4(p_platform,p_account) j)
select jsonb_set(b.j,'{months}',coalesce((select jsonb_agg(jsonb_set(m,'{items}',coalesce((
  select jsonb_agg(case when it->>'account'='NOVO' then it || jsonb_build_object('skus',(
     select count(distinct n) from (
       select regexp_replace(upper(s.sku),'[^A-Z0-9]','','g') n from public.commerce_listing_variation_skus_v1 s where s.platform='ML' and s.external_listing_id in (select jsonb_array_elements_text(it->'listing_ids'))
       union
       select v.sku_norm from public.commerce_current_sales_listing_daily_v1 v where v.external_listing_id in (select jsonb_array_elements_text(it->'listing_ids')) and v.sku_norm is not null) q),
     'product_url',(select min(l.source_url) from public.commerce_listings l where l.external_listing_id in (select jsonb_array_elements_text(it->'listing_ids')) and l.source_url like 'https://www.mercadolivre.com.br/%'))
     else it end order by o) from jsonb_array_elements(m->'items') with ordinality t(it,o)),'[]'::jsonb)) order by m->>'month') from jsonb_array_elements(b.j->'months') m),'[]'::jsonb))
from base b;
$f$;
revoke all on function public.commerce_listing_cohorts_v5(text,text) from public,anon,authenticated;
grant execute on function public.commerce_listing_cohorts_v5(text,text) to service_role;
