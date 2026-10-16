-- NISTI: strict SKU 2026-to-2027 reconciliation for PB/PLAN/AGMT/CONFIN/VACMNO/VACMNA.
-- Only a 26->27 year change after the product family is allowed; keep all
-- cover/accessory characters unchanged; SKU normalization ignores separators.
-- VACMNO/VACMNA without a year already match by exact SKU (no alias needed).
-- Exclude duplicated, reviewed or revoked codes; keep Scanner/sale/listing SKUs.
create or replace function public.commerce_shopee_auto_link_year26_v1()
returns jsonb language plpgsql volatile security invoker set search_path=public as $fn$
declare v_count integer;v_units bigint;v_revenue numeric;
begin
  -- Prevent concurrent auto-link batches from interleaving their validations.
  perform pg_advisory_xact_lock(2026, 2727);

  with sales as (
    select public.commerce_nisti_sku_norm_v1(r.sku_norm) source_sku,
      sum(r.units)::bigint units,round(sum(r.product_revenue),2)::numeric revenue
    from public.commerce_sales_rows r
    join public.commerce_sales_snapshots sn
      on sn.id=r.snapshot_id and sn.is_current
    where r.platform_code='SHOPEE'
    group by public.commerce_nisti_sku_norm_v1(r.sku_norm)
  ), source_codes as (
    select s.source_sku,s.units,s.revenue,
      case when s.source_sku ~ '^PB26[A-Z0-9]{3,}$' then 'PB'
           when s.source_sku ~ '^PLAN26[A-Z0-9]{3,}$' then 'PLAN'
           when s.source_sku ~ '^AGMT26[A-Z0-9]{3,}$' then 'AGMT'
           when s.source_sku ~ '^CONFIN26[A-Z0-9]{3,}$' then 'CONFIN'
           when s.source_sku ~ '^VACMNO26[A-Z0-9]{3,}$' then 'VACMNO'
           when s.source_sku ~ '^VACMNA26[A-Z0-9]{3,}$' then 'VACMNA'
           else null end family
    from sales s
  ), year_candidates as (
    select s.*,
      case when family='PB' then 'PB27'||substr(source_sku,5)
           when family='PLAN' then 'PLAN27'||substr(source_sku,7)
           when family='AGMT' then 'AGMT27'||substr(source_sku,7)
           when family='CONFIN' then 'CONFIN27'||substr(source_sku,9)
           when family='VACMNO' then 'VACMNO27'||substr(source_sku,9)
           when family='VACMNA' then 'VACMNA27'||substr(source_sku,9)
           else null end target_sku
    from source_codes s
    where family is not null
  ), active_variations as (
    select lp.id listing_product_id,
      public.commerce_nisti_sku_norm_v1(lp.platform_sku) sku_norm
    from public.commerce_listing_products lp
    join public.commerce_listings l on l.id=lp.listing_id
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where m.code='SHOPEE' and l.listing_status='ACTIVE'
      and lp.relation_status<>'REMOVED'
      and nullif(lp.variation_id,'') is not null
  ), unique_targets as (
    select sku_norm,min(listing_product_id) listing_product_id
    from active_variations where nullif(sku_norm,'') is not null
    group by sku_norm having count(*)=1
  ), eligible as (
    select c.source_sku,c.units,c.revenue,u.listing_product_id,
      c.target_sku,c.family
    from year_candidates c
    join unique_targets u on u.sku_norm=c.target_sku
    where c.source_sku<>c.target_sku
      -- A source already present on an active variation is not an alias.
      and not exists (
        select 1 from active_variations v where v.sku_norm=c.source_sku
      )
      -- Never overwrite user confirmations or re-enable revoked mappings.
      and not exists (
        select 1 from public.commerce_shopee_sales_sku_alias_reviews_v1 a
        where a.source_sku_norm=c.source_sku
      )
  ), inserted as (
    insert into public.commerce_shopee_sales_sku_alias_reviews_v1(
      source_sku_norm,listing_product_id,active,evidence,
      approved_by,approved_at,updated_at
    )
    select e.source_sku,e.listing_product_id,true,
      'Regra NISTI automática: '||e.family||'26 para '||e.family||
      '27; miolo, capa e acessórios idênticos após normalizar "_" e retirar só o ano; SKU de destino exclusivo.',
      'NISTI_AUTO_YEAR_26_27',now(),now()
    from eligible e
    on conflict (source_sku_norm) do nothing
    returning source_sku_norm
  ), linked as (
    select count(*)::int mappings,
      coalesce(sum(s.units),0)::bigint units,
      coalesce(round(sum(s.revenue),2),0)::numeric revenue
    from inserted i join sales s on s.source_sku=i.source_sku_norm
  )
  select mappings,units,revenue into v_count,v_units,v_revenue from linked;
  return jsonb_build_object('linked_skus',coalesce(v_count,0),
    'linked_units',coalesce(v_units,0),
    'linked_revenue',coalesce(v_revenue,0),
    'rule','PB/PLAN/AGMT/CONFIN/VACMNO/VACMNA: 26>27; sufixo completo igual; alvo único',
    'reversible',true);
end $fn$;
revoke all on function public.commerce_shopee_auto_link_year26_v1()
  from public,anon,authenticated;
grant execute on function public.commerce_shopee_auto_link_year26_v1()
  to service_role;
