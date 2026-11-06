-- Ficha do anúncio (Shopee): histórico semanal de vendas, preço praticado, cancelamento, frete, taxas,
-- funil por relatório de desempenho e Shopee Ads. Só leitura; não altera nenhuma tabela.
-- Anúncio -> SKUs pelo mesmo vínculo revisado usado em commerce_shopee_listing_finance_v1.
create or replace function public.commerce_shopee_listing_sheet_v1(p_listing_id bigint, p_weeks integer default 26)
returns jsonb language sql stable security invoker set search_path=public as $fn$
with prm as (select greatest(4,least(coalesce(p_weeks,26),52)) w),
lst as (select l.id,l.external_listing_id,l.title from public.commerce_listings l where l.id=p_listing_id),
own as (select distinct o.source_sku_norm sku from public.commerce_shopee_sku_owner_reviewed_v1 o where o.listing_id=p_listing_id),
last_day as (
  select max(d.sale_date) d from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id and b.platform_code='SHOPEE' and b.status='COMMITTED'),
bounds as (
  select (date_trunc('week',(select d from last_day))::date-((select w from prm)-1)*7) start_day,
         (select d from last_day) end_day),
sales as (
  select date_trunc('week',d.sale_date)::date wk,sum(d.units)::int units,sum(d.product_revenue) revenue
  from public.commerce_shopee_sales_sku_daily_v1 d
  join public.commerce_sales_import_batches b on b.id=d.batch_id and b.platform_code='SHOPEE' and b.status='COMMITTED'
  join own on own.sku=d.sku_norm
  where d.sale_date between (select start_day from bounds) and (select end_day from bounds)
  group by 1),
ex_rows as (
  select x.*
  from public.commerce_shopee_order_extras_daily_v1 x
  join public.commerce_sales_import_batches b on b.id=x.batch_id and b.platform_code='SHOPEE' and b.status='COMMITTED'
  join own on own.sku=x.sku_norm
  where x.sale_date between (select start_day from bounds) and (select end_day from bounds)),
ex as (
  select date_trunc('week',sale_date)::date wk,sum(units)::int units,sum(price_paid_sum) paid,sum(price_orig_sum) orig,
    min(price_paid_min) pmin,max(price_paid_max) pmax,sum(cancelled_units)::int canc,
    sum(ship_orders)::int ship_orders,sum(ship_est) ship_est,sum(ship_paid) ship_paid
  from ex_rows group by 1),
fin as (
  select date_trunc('week',d.sale_date)::date wk,sum(d.commission_net+d.service_net+d.transaction_fee) fees,sum(d.product_revenue) rev
  from public.commerce_shopee_finance_daily_v1 d
  join public.commerce_shopee_finance_current_month_v1 fm on fm.month_start=d.month_start and fm.source_snapshot_id=d.source_snapshot_id
  join own on own.sku=d.sku_norm
  where d.sale_date between (select start_day from bounds) and (select end_day from bounds)
  group by 1),
weeks as (
  select g::date wk from generate_series((select start_day from bounds),(select end_day from bounds),interval '7 days') g),
reasons as (
  select e.key reason,sum(e.value::int) units from ex_rows r,jsonb_each_text(r.cancel_reasons) e group by 1 order by 2 desc limit 6),
ufs as (
  select e.key uf,sum(e.value::int) units from ex_rows r,jsonb_each_text(r.uf_units) e group by 1 order by 2 desc limit 6),
funnel as (
  select rep.period_start,rep.period_end,p.visitors,p.page_views,p.add_cart_visitors,p.orders_placed,p.units_placed,
    p.revenue_paid,p.impressions,p.clicks
  from public.commerce_shopee_performance_rows_v1 p
  join public.commerce_shopee_performance_reports_v1 rep on rep.id=p.report_id
  where p.listing_id=p_listing_id),
ads as (
  select rep.period_start,rep.period_end,sum(r.impressions) impressions,sum(r.clicks) clicks,sum(r.items_sold) items_sold,
    sum(r.gmv) gmv,sum(r.spend) spend
  from public.commerce_shopee_ads_rows_v1 r
  join public.commerce_shopee_ads_reports_v1 rep on rep.id=r.report_id and rep.report_kind='GENERAL'
  where r.listing_id=p_listing_id
  group by rep.id,rep.period_start,rep.period_end)
select jsonb_build_object(
  'listing_id',p_listing_id,
  'external_listing_id',(select external_listing_id from lst),
  'title',(select title from lst),
  'skus',(select count(*) from own),
  'sales_through',(select d from last_day),
  'period_start',(select start_day from bounds),
  'weeks',coalesce((select jsonb_agg(jsonb_build_object(
      'week_start',w.wk,'partial',(w.wk+6)>(select d from last_day),
      'units',coalesce(s.units,0),'revenue',round(coalesce(s.revenue,0),2),
      'has_extras',e.wk is not null,
      'extras_units',e.units,
      'price_paid_avg',case when coalesce(e.units,0)>0 then round(e.paid/e.units,2) end,
      'price_orig_avg',case when coalesce(e.units,0)>0 then round(e.orig/e.units,2) end,
      'price_paid_min',e.pmin,'price_paid_max',e.pmax,
      'cancelled_units',e.canc,
      'ship_est_avg',case when coalesce(e.ship_orders,0)>0 then round(e.ship_est/e.ship_orders,2) end,
      'ship_paid_avg',case when coalesce(e.ship_orders,0)>0 then round(e.ship_paid/e.ship_orders,2) end,
      'fee_pct',case when coalesce(f.rev,0)>0 then round(f.fees/f.rev*100,1) end
    ) order by w.wk)
    from weeks w left join sales s on s.wk=w.wk left join ex e on e.wk=w.wk left join fin f on f.wk=w.wk),'[]'::jsonb),
  'cancel_reasons',coalesce((select jsonb_agg(jsonb_build_object('reason',reason,'units',units) order by units desc) from reasons),'[]'::jsonb),
  'uf_units',coalesce((select jsonb_agg(jsonb_build_object('uf',uf,'units',units) order by units desc) from ufs),'[]'::jsonb),
  'funnel',coalesce((select jsonb_agg(to_jsonb(f) order by f.period_start,f.period_end) from funnel f),'[]'::jsonb),
  'ads',coalesce((select jsonb_agg(to_jsonb(a) order by a.period_start) from ads a),'[]'::jsonb)
) where exists(select 1 from lst);
$fn$;
revoke all on function public.commerce_shopee_listing_sheet_v1(bigint,integer) from public,anon,authenticated;
grant execute on function public.commerce_shopee_listing_sheet_v1(bigint,integer) to service_role;
