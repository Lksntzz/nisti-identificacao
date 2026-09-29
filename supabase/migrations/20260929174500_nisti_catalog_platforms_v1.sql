create or replace function public.commerce_nisti_product_platforms_v1()
returns table(
  nisti_product_id bigint,
  platforms jsonb
)
language sql
stable
security invoker
set search_path=''
as $function$
with latest_files as (
  select distinct on (upper(sf.source_code))
    sf.id,
    upper(sf.source_code) as source_code
  from public.commerce_source_files sf
  where upper(sf.source_code) not in ('GS_REFERENCIA','CONTROLE_VIDEOS','ANUNCIOS_NOVOS')
  order by upper(sf.source_code),sf.imported_at desc nulls last,sf.id desc
),
presence as (
  select distinct
    nl.nisti_product_id,
    case
      when lf.source_code like 'SHOPEE%' then 'SHOPEE'
      when lf.source_code like 'ML_NOVO%' then 'ML_NOVO'
      when lf.source_code like 'ML_ANTIGO%' then 'ML_ANTIGO'
      when lf.source_code like 'AMAZON%' then 'AMAZON'
      when lf.source_code like 'MAGALU%' then 'MAGALU'
      when lf.source_code like 'SHEIN%' then 'SHEIN'
      when lf.source_code like 'LOJA_INTEGRADA%' then 'LOJA_INTEGRADA'
      when lf.source_code like 'KWAI%' then 'KWAI'
      when lf.source_code like 'TIKTOK%' then 'TIKTOK'
      when lf.source_code like 'ALIEXPRESS%' then 'ALIEXPRESS'
      else lf.source_code
    end as platform_code
  from public.commerce_nisti_product_links nl
  join public.commerce_source_rows sr
    on sr.matched_product_id=nl.commerce_product_id
   and sr.is_header=false
  join latest_files lf on lf.id=sr.source_file_id
  where nl.sync_status='SYNCED'
    and nl.commerce_product_id is not null
),
labeled as (
  select
    p.nisti_product_id,
    p.platform_code,
    case p.platform_code
      when 'SHOPEE' then 'Shopee'
      when 'ML_NOVO' then 'ML Novo'
      when 'ML_ANTIGO' then 'ML Antigo'
      when 'AMAZON' then 'Amazon'
      when 'MAGALU' then 'Magalu'
      when 'SHEIN' then 'Shein'
      when 'LOJA_INTEGRADA' then 'Site'
      when 'KWAI' then 'Kwai'
      when 'TIKTOK' then 'TikTok'
      when 'ALIEXPRESS' then 'AliExpress'
      else initcap(replace(lower(p.platform_code),'_',' '))
    end as platform_label,
    case p.platform_code
      when 'SHOPEE' then 1
      when 'ML_NOVO' then 2
      when 'ML_ANTIGO' then 3
      when 'AMAZON' then 4
      when 'MAGALU' then 5
      when 'SHEIN' then 6
      when 'LOJA_INTEGRADA' then 7
      when 'KWAI' then 8
      when 'TIKTOK' then 9
      when 'ALIEXPRESS' then 10
      else 99
    end as sort_order
  from presence p
),
aggregated as (
  select
    l.nisti_product_id,
    jsonb_agg(
      jsonb_build_object('code',l.platform_code,'label',l.platform_label)
      order by l.sort_order,l.platform_label
    ) as platforms
  from labeled l
  group by l.nisti_product_id
)
select
  nl.nisti_product_id,
  coalesce(a.platforms,'[]'::jsonb) as platforms
from public.commerce_nisti_product_links nl
left join aggregated a on a.nisti_product_id=nl.nisti_product_id
order by nl.nisti_product_id;
$function$;

revoke execute on function public.commerce_nisti_product_platforms_v1()
from public,anon,authenticated;
grant execute on function public.commerce_nisti_product_platforms_v1()
to service_role;
