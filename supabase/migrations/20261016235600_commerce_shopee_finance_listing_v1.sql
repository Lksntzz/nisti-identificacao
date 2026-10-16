-- Read-only reconciliation: source financial batches are eligible only if the
-- COMMITTED batch group reconciles with the CURRENT monthly sales snapshot.
-- Part files share a snapshot_id and must be added together before evaluation.
-- No unlinked fee is assigned to a listing or variation.
create or replace function public.commerce_shopee_finance_listing_v1(
 p_listing_id bigint,p_days integer default 30,p_month text default null
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as (
 select case when p_days in (7,30,60,90) then p_days else 30 end days,
        case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' then p_month else null end month_key
), last_import as (
 select max(data_through)::date last_day from public.commerce_sales_snapshots where is_current
), period as (
 select case when i.month_key is not null
  then to_date(i.month_key||'-01','YYYY-MM-DD')
  else d.last_day-i.days+1 end start_day,
 case when i.month_key is not null
  then least((to_date(i.month_key||'-01','YYYY-MM-DD')+interval '1 month - 1 day')::date,
          coalesce(d.last_day,current_date))
  else d.last_day end end_day
 from input i cross join last_import d
), current_months as (
 select date_trunc('month',s.period_start)::date month_start,
   sum(s.net_orders)::integer total_orders,
   sum(s.units)::bigint total_units,
   round(sum(s.product_revenue),2)::numeric total_revenue
 from public.commerce_sales_summary_rows s
 join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current
 where s.platform_code='SHOPEE'
 group by 1
), candidate as (
 select b.snapshot_id,m.month_start,
   sum(m.units)::bigint units,round(sum(m.product_revenue),2)::numeric revenue,
   sum(m.orders)::bigint orders,
   sum(m.fee_orders)::bigint fee_orders,
   sum(m.unallocated_orders)::bigint unallocated_orders,
   count(*)::integer batch_parts
 from public.commerce_shopee_finance_month_v1 m
 join public.commerce_sales_import_batches b on b.id=m.batch_id
 where b.status='COMMITTED' and b.snapshot_id is not null
 group by b.snapshot_id,m.month_start
), matched as (
 select c.* from candidate c
 join current_months s on s.month_start=c.month_start and s.total_units=c.units
   and abs(s.total_revenue-c.revenue)<=0.02 and s.total_orders=c.orders
), preferred as (
 select distinct on(month_start) month_start,snapshot_id,batch_parts
 from matched order by month_start,snapshot_id desc
), source_batches as (
 select b.id batch_id,m.month_start
 from preferred p
 join public.commerce_shopee_finance_month_v1 m on m.month_start=p.month_start
 join public.commerce_sales_import_batches b on b.id=m.batch_id
   and b.snapshot_id=p.snapshot_id and b.status='COMMITTED'
), owned_skus as (
 select o.source_sku_norm
 from public.commerce_shopee_sku_owner_reviewed_v1 o
 where o.listing_id=p_listing_id
 group by o.source_sku_norm
 having count(distinct o.listing_id)=1
 -- Also reject any source SKU with ownership by ANOTHER active listing.
 and not exists(
   select 1 from public.commerce_shopee_sku_owner_reviewed_v1 other
   where other.source_sku_norm=o.source_sku_norm and other.listing_id<>p_listing_id)
), selected as (
 select f.sale_date,f.sku_norm,f.orders,f.units,f.product_revenue,
   f.seller_discount,f.transaction_fee,f.commission_net,f.service_net
 from public.commerce_shopee_finance_sku_daily_v1 f
 join source_batches src on src.batch_id=f.batch_id
  and src.month_start=date_trunc('month',f.sale_date)::date
 join owned_skus o on o.source_sku_norm=f.sku_norm
 cross join period p
 where p.start_day is not null and f.sale_date between p.start_day and p.end_day
), totals as (
 select count(*)::integer source_rows,
   coalesce(sum(orders),0)::bigint fee_orders,
   coalesce(sum(units),0)::bigint units,
   coalesce(round(sum(product_revenue),2),0)::numeric product_revenue,
   coalesce(round(sum(seller_discount),2),0)::numeric seller_discount,
   coalesce(round(sum(transaction_fee),2),0)::numeric transaction_fee,
   coalesce(round(sum(commission_net),2),0)::numeric commission_net,
   coalesce(round(sum(service_net),2),0)::numeric service_net
 from selected
), source_coverage as (
 select count(distinct p.month_start)::integer available_months
 from preferred p cross join period w
 where p.month_start between date_trunc('month',w.start_day)::date
   and date_trunc('month',w.end_day)::date
), listing_check as (
 select exists(select 1 from public.commerce_listings l
  join public.commerce_marketplaces m on m.id=l.marketplace_id
  where l.id=p_listing_id and m.code='SHOPEE') valid_listing
)
select jsonb_build_object(
 'status',case when not (select valid_listing from listing_check) then 'NOT_SHOPEE'
   when (select source_rows from totals)=0 then 'AWAITING_FINANCIAL_RECONCILIATION'
   else 'PARTIAL_FINANCIAL_RECONCILIATION' end,
 'period_start',(select start_day from period),
 'period_end',(select end_day from period),
 'available_months',(select available_months from source_coverage),
 'expected_months',(select count(*) from generate_series(
   date_trunc('month',start_day)::date,date_trunc('month',end_day)::date,
   interval '1 month') from period),
 'fee_orders',(select fee_orders from totals),
 'units',(select units from totals),
 'product_revenue',(select product_revenue from totals),
 'seller_discount',(select seller_discount from totals),
 'transaction_fee',(select transaction_fee from totals),
 'commission_net',(select commission_net from totals),
 'service_net',(select service_net from totals),
 'after_reported_fees',(select round(product_revenue-transaction_fee-commission_net-service_net,2) from totals),
 'seller_discount_in_subtotal',true,
 'payout_confirmed',false
);
$fn$;
revoke all on function public.commerce_shopee_finance_listing_v1(bigint,integer,text)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_finance_listing_v1(bigint,integer,text)
 to service_role;
