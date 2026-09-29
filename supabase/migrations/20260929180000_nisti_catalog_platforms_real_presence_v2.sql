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
with source_files as (
  select
    sf.id,
    upper(sf.source_code) as source_code,
    sf.imported_at,
    case
      when upper(sf.source_code) like 'SHOPEE%' then 'SHOPEE'
      when upper(sf.source_code) like 'ML_NOVO%' then 'ML_NOVO'
      when upper(sf.source_code) like 'ML_ANTIGO%' then 'ML_ANTIGO'
      when upper(sf.source_code) like 'AMAZON%' then 'AMAZON'
      when upper(sf.source_code) like 'MAGALU%' then 'MAGALU'
      when upper(sf.source_code) like 'SHEIN%' then 'SHEIN'
      when upper(sf.source_code) like 'LOJA_INTEGRADA%' then 'LOJA_INTEGRADA'
      when upper(sf.source_code) like 'KWAI%' then 'KWAI'
      when upper(sf.source_code) like 'TIKTOK%' then 'TIKTOK'
      when upper(sf.source_code) like 'ALIEXPRESS%' then 'ALIEXPRESS'
      else upper(sf.source_code)
    end as platform_code,
    case when upper(sf.source_code) like '%_GESTAO' then 0 else 1 end as source_priority
  from public.commerce_source_files sf
  where upper(sf.source_code) not in ('GS_REFERENCIA','CONTROLE_VIDEOS','ANUNCIOS_NOVOS')
),
preferred_files as (
  select distinct on (platform_code)
    id,
    source_code,
    platform_code
  from source_files
  order by platform_code,source_priority,imported_at desc nulls last,id desc
),
presence as (
  select distinct
    nl.nisti_product_id,
    pf.platform_code
  from public.commerce_nisti_product_links nl
  join public.commerce_source_rows sr
    on sr.matched_product_id=nl.commerce_product_id
   and sr.is_header=false
  join preferred_files pf on pf.id=sr.source_file_id
  where nl.sync_status='SYNCED'
    and nl.commerce_product_id is not null
    and coalesce(
      nullif(trim(sr.normalized_payload->>'listing_url'),''),
      nullif(trim(sr.normalized_payload->>'listing_ref'),''),
      nullif(trim(sr.normalized_payload->>'external_listing_id'),'')
    ) is not null
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
