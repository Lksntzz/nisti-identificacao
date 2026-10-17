-- Financial detail only includes single-SKU paid orders with consistent order-level
-- fees, mapped to a unique currently active advertisement. Never claims net payout.
create or replace function public.commerce_shopee_listing_finance_v1(
 p_listing_id bigint, p_month text default null, p_days integer default 30
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with input as (
 select
   p_listing_id listing_id,
   (p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$') month_mode,
   case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
     then to_date(p_month||'-01','YYYY-MM-DD') else null end month_start,
   case when p_days in (7,30,60,90) then p_days else 30 end days
), last_sale as (
 select max(s.sale_date)::date as last_day
 from public.commerce_shopee_sales_sku_daily_v1 s
 join public.commerce_sales_import_batches b on b.id=s.batch_id
 where b.status='COMMITTED'
), bounds as (
 select i.listing_id,
  case when i.month_mode then i.month_start
    else l.last_day-(i.days-1) end start_date,
  case when i.month_mode then
    (select coalesce(max(sr.period_end), (i.month_start+interval '1 month - 1 day')::date)
     from public.commerce_sales_summary_rows sr
     join public.commerce_sales_snapshots sn on sn.id=sr.snapshot_id and sn.is_current
     where sr.platform_code='SHOPEE' and sr.period_start=i.month_start)
    else l.last_day end end_date
 from input i cross join last_sale l
), imported as (
 select distinct on (date_trunc('month',s.period_start)::date)
   date_trunc('month',s.period_start)::date month_start,b.snapshot_id
 from public.commerce_sales_import_batches b
 join public.commerce_sales_import_stage_rows s on s.batch_id=b.id
 cross join bounds z
 where b.platform_code='SHOPEE' and b.status='COMMITTED' and b.snapshot_id is not null
 and s.period_start between date_trunc('month',z.start_date)::date and z.end_date
 order by date_trunc('month',s.period_start)::date,
 b.committed_at desc nulls last,b.id desc
), fees as (
 select f.orders,f.units,f.product_revenue,f.seller_discount,
   f.commission_net,f.service_net,f.transaction_fee,f.sku_norm
 from public.commerce_shopee_finance_sku_daily_v1 f
 join public.commerce_sales_import_batches b on b.id=f.batch_id and b.status='COMMITTED'
 join imported i on i.snapshot_id=b.snapshot_id
   and i.month_start=date_trunc('month',f.sale_date)::date
 join public.commerce_shopee_sku_owner_reviewed_v1 o
  on o.source_sku_norm=f.sku_norm
 cross join bounds z
 where o.listing_id=z.listing_id and f.sale_date between z.start_date and z.end_date
), summed as (
 select count(*)::int matched_sku_days,coalesce(sum(orders),0)::bigint orders,
 coalesce(sum(units),0)::bigint units,
 coalesce(round(sum(product_revenue),2),0)::numeric subtotal,
 coalesce(round(sum(seller_discount),2),0)::numeric seller_discount,
 coalesce(round(sum(commission_net),2),0)::numeric commission_net,
 coalesce(round(sum(service_net),2),0)::numeric service_net,
 coalesce(round(sum(transaction_fee),2),0)::numeric transaction_fee
 from fees
)
select jsonb_build_object(
 'available',(select orders>0 from summed),
 'scope','SINGLE_SKU_ORDERS_ONLY',
 'period_start',(select start_date from bounds),
 'period_end',(select end_date from bounds),
 'orders',(select orders from summed),'units',(select units from summed),
 'subtotal',(select subtotal from summed),
 'seller_discount',(select seller_discount from summed),
 'commission_net',(select commission_net from summed),
 'service_net',(select service_net from summed),
 'transaction_fee',(select transaction_fee from summed),
 'after_identified_fees',(select subtotal-commission_net-service_net-transaction_fee from summed),
 'discount_already_in_subtotal',true,
 'full_payout',false
);
$fn$;
revoke all on function public.commerce_shopee_listing_finance_v1(bigint,text,integer)
from public,anon,authenticated;
grant execute on function public.commerce_shopee_listing_finance_v1(bigint,text,integer)
to service_role;
