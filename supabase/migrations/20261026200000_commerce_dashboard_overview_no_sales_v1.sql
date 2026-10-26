-- Somente leitura. Inclui no_sales (ativos sem venda, mais novos primeiro). Complementos do dashboard: pedidos, situacao dos anuncios, alertas,
-- melhores produtos por criterio, Shopee Ads (ultimo relatorio) e confiabilidade dos dados.
-- Janela atual = ultimos p_days dias com venda importada; anterior = mesmo tamanho imediatamente antes.
create or replace function public.commerce_dashboard_overview_v1(
  p_platform text default 'TODAS', p_days integer default 30
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'')) in ('SHOPEE','ML_ANTIGO','ML_NOVO') then upper(p_platform) else 'TODAS' end plat,
         case when p_days in (7,30,60,90) then p_days else 30 end days
), base as (
  select v.* from public.commerce_current_sales_listing_daily_v1 v, params p
  where p.plat='TODAS' or v.platform_code=p.plat
), ref as (
  select max(sale_date) last_day from base
), win as (
  select b.platform_code,b.external_listing_id,
    max(nullif(btrim(b.sku_norm),'')) sku,
    coalesce(sum(b.units) filter (where b.sale_date>r.last_day-p.days),0) cur_units,
    coalesce(sum(b.product_revenue) filter (where b.sale_date>r.last_day-p.days),0) cur_rev,
    coalesce(sum(b.orders_with_item) filter (where b.sale_date>r.last_day-p.days),0) cur_orders,
    coalesce(sum(b.units) filter (where b.sale_date<=r.last_day-p.days and b.sale_date>r.last_day-2*p.days),0) prev_units,
    coalesce(sum(b.product_revenue) filter (where b.sale_date<=r.last_day-p.days and b.sale_date>r.last_day-2*p.days),0) prev_rev,
    coalesce(sum(b.orders_with_item) filter (where b.sale_date<=r.last_day-p.days and b.sale_date>r.last_day-2*p.days),0) prev_orders
  from base b cross join params p cross join ref r
  where b.sale_date>r.last_day-2*p.days
  group by b.platform_code,b.external_listing_id
), lst as (
  select w.*,l.id listing_id,l.title,l.listing_status
  from win w
  left join lateral (
    select l.id,l.title,l.listing_status from public.commerce_listings l
    join public.commerce_marketplaces m on m.id=l.marketplace_id
    where l.external_listing_id=w.external_listing_id
      and (case when m.code='MERCADO_LIVRE' then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end)=w.platform_code
    order by (l.listing_status='ACTIVE') desc,l.id limit 1
  ) l on true
), cat as (
  select l.id,l.listing_status,l.external_listing_id,
    case when m.code='MERCADO_LIVRE' then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end src
  from public.commerce_listings l join public.commerce_marketplaces m on m.id=l.marketplace_id, params p
  where p.plat='TODAS' or (case when m.code='MERCADO_LIVRE' then case upper(coalesce(l.account_code,'')) when 'NOVO' then 'ML_NOVO' else 'ML_ANTIGO' end else m.code end)=p.plat
), active_sales as (
  select c.id,coalesce(l.cur_units,0) cur_units
  from cat c left join lst l on l.listing_id=c.id where c.listing_status='ACTIVE'
), growth as (
  select * from lst where listing_status='ACTIVE' and prev_units>=5 and cur_units>=10
    and (cur_units-prev_units)::numeric/prev_units>=0.15
), ads_rep as (
  select id,period_start,period_end,exported_at from public.commerce_shopee_ads_reports_v1
  where report_kind='GENERAL' order by period_end desc,id desc limit 1
), ads as (
  select r.campaign_name,r.listing_id,l.title,r.impressions,r.clicks,r.items_sold,r.gmv,r.spend,r.roas
  from public.commerce_shopee_ads_rows_v1 r join ads_rep a on a.id=r.report_id
  left join public.commerce_listings l on l.id=r.listing_id
), cover as (
  select v.platform_code,max(v.sale_date) last_day,min(v.sale_date) first_day,count(distinct v.sale_date) days_with_sales
  from base v group by v.platform_code
), imp as (
  select b.platform_code,max(b.committed_at) last_import
  from public.commerce_sales_import_batches b, params p
  where b.status='COMMITTED' and (p.plat='TODAS' or b.platform_code=p.plat) group by b.platform_code
)
select jsonb_build_object(
  'orders',jsonb_build_object('current',(select coalesce(sum(cur_orders),0) from lst),'previous',(select coalesce(sum(prev_orders),0) from lst)),
  'listings',jsonb_build_object(
    'active',(select count(*) from cat where listing_status='ACTIVE'),
    'inactive',(select count(*) from cat where listing_status='INACTIVE'),
    'active_without_sales',(select count(*) from active_sales where cur_units=0),
    'inactive_with_sales',(select count(*) from lst where listing_status in ('INACTIVE','REMOVED') and cur_units>0)),
  'no_sales_total',(select count(*) from active_sales where cur_units=0),
  'no_sales',coalesce((select jsonb_agg(jsonb_build_object('listing_id',x.id,'platform',x.src,'external_id',x.external_listing_id,
      'title',x.title,'created_at',x.created_at) order by x.id desc)
      from (select c.id,c.src,c.external_listing_id,l.title,l.created_at from cat c
            join active_sales a on a.id=c.id join public.commerce_listings l on l.id=c.id
            where c.listing_status='ACTIVE' and a.cur_units=0 order by c.id desc limit 50) x),'[]'::jsonb),
  'top_units',coalesce((select jsonb_agg(jsonb_build_object('listing_id',listing_id,'platform',platform_code,'external_id',external_listing_id,
      'title',title,'units',cur_units,'revenue',round(cur_rev,2),'units_previous',prev_units) order by cur_units desc,external_listing_id)
      from (select * from lst where cur_units>0 order by cur_units desc,external_listing_id limit 10) x),'[]'::jsonb),
  'growth',coalesce((select jsonb_agg(jsonb_build_object('listing_id',listing_id,'platform',platform_code,'external_id',external_listing_id,
      'title',title,'units',cur_units,'revenue',round(cur_rev,2),'units_previous',prev_units,'revenue_previous',round(prev_rev,2))
      order by (cur_units-prev_units) desc,external_listing_id)
      from (select * from growth order by (cur_units-prev_units) desc,external_listing_id limit 10) x),'[]'::jsonb),
  'stopped',coalesce((select jsonb_agg(jsonb_build_object('listing_id',listing_id,'platform',platform_code,'external_id',external_listing_id,
      'title',title,'units_previous',prev_units,'revenue_previous',round(prev_rev,2)) order by prev_rev desc)
      from (select * from lst where listing_status='ACTIVE' and cur_units=0 and prev_units>=3 order by prev_rev desc limit 10) x),'[]'::jsonb),
  'unlinked',jsonb_build_object(
    'revenue',(select round(coalesce(sum(cur_rev) filter (where sku is null),0),2) from lst),
    'revenue_total',(select round(coalesce(sum(cur_rev),0),2) from lst),
    'listings',(select count(*) from lst where sku is null and cur_units>0)),
  'ads',jsonb_build_object(
    'period_start',(select period_start from ads_rep),'period_end',(select period_end from ads_rep),
    'rows',coalesce((select jsonb_agg(jsonb_build_object('campaign',campaign_name,'listing_id',listing_id,'title',title,'impressions',impressions,
        'clicks',clicks,'items_sold',items_sold,'gmv',gmv,'spend',spend,'roas',roas) order by spend desc nulls last) from ads),'[]'::jsonb)),
  'coverage',coalesce((select jsonb_agg(jsonb_build_object('platform',c.platform_code,'first_day',c.first_day,'last_day',c.last_day,
      'last_import',i.last_import) order by c.platform_code) from cover c left join imp i on i.platform_code=c.platform_code),'[]'::jsonb),
  'window_days_with_sales',(select count(distinct sale_date) from base,ref,params where sale_date>ref.last_day-params.days)
);
$function$;
revoke all on function public.commerce_dashboard_overview_v1(text,integer) from public,anon,authenticated;
grant execute on function public.commerce_dashboard_overview_v1(text,integer) to service_role;
