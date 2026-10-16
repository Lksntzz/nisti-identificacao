-- Reports attributable Shopee fees only for complete, uniquely owned
-- single-SKU orders. Never distributes multi-SKU order fees by guesswork.
-- Financial rows must come from the most recent COMMITTED sales import of
-- each source month, and match the current authoritative snapshot month.
create or replace function public.commerce_shopee_listing_finance_v1(
  p_listing_external_id text,p_days integer default 30,p_month text default null
) returns jsonb language sql stable security invoker set search_path=public as $fn$
with args as(
 select nullif(btrim(p_listing_external_id),'') listing_external,
  case when p_days in (7,30,60,90) then p_days else 30 end days,
  case when p_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
    then to_date(p_month||'-01','YYYY-MM-DD') else null end requested_month
), current_periods as(
 select date_trunc('month',s.period_start)::date month_start,
   max(s.period_end)::date period_end
 from public.commerce_sales_summary_rows s
 join public.commerce_sales_snapshots sn on sn.id=s.snapshot_id and sn.is_current
 where s.platform_code='SHOPEE'
 group by 1
), bounds as(
 select case when a.requested_month is not null then a.requested_month
   else (select max(period_end) from current_periods)-a.days+1 end start_date,
  case when a.requested_month is not null then
     (select period_end from current_periods where month_start=a.requested_month)
   else (select max(period_end) from current_periods) end end_date,
  a.listing_external
 from args a
), latest_source as(
 select date_trunc('month',r.period_start)::date month_start,
  max(b.snapshot_id) snapshot_id
 from public.commerce_sales_import_batches b
 join public.commerce_sales_import_stage_rows r on r.batch_id=b.id
 where b.platform_code='SHOPEE' and b.status='COMMITTED'
   and b.snapshot_id is not null
 group by 1
), finance_source as(
 select f.*,b.snapshot_id
 from public.commerce_shopee_financial_orders_v1 f
 join public.commerce_sales_import_batches b on b.id=f.batch_id
 join latest_source l on l.month_start=f.month_start and l.snapshot_id=b.snapshot_id
 join current_periods cp on cp.month_start=f.month_start and f.sale_date<=cp.period_end
 cross join bounds d
 where b.platform_code='SHOPEE' and b.status='COMMITTED'
   and f.sale_date between d.start_date and d.end_date
), orders as(
 select month_start,order_hash,
  case when count(*)=1 then max(sku_norm) else null end sku_norm,
  case when count(*)=1 then bool_and(fee_valid) else false end fee_valid,
  count(*)>1 as repeated_across_parts,
  case when count(*)=1 then max(product_revenue) else null end product_revenue,
  case when count(*)=1 then max(seller_discount) else null end seller_discount,
  case when count(*)=1 then max(transaction_fee) else null end transaction_fee,
  case when count(*)=1 then max(commission_net) else null end commission_net,
  case when count(*)=1 then max(service_net) else null end service_net
 from finance_source group by month_start,order_hash
), owners as(
 select source_sku_norm,min(external_listing_id) external_listing_id
 from public.commerce_shopee_sku_owner_reviewed_v1
 group by source_sku_norm having count(*)=1
), classified as(
 select o.*,owner.external_listing_id
 from orders o left join owners owner on owner.source_sku_norm=o.sku_norm
), sums as(
 select count(*)::integer all_finance_orders,
  count(*) filter(where repeated_across_parts)::integer overlapping_orders,
  count(*) filter(where fee_valid)::integer all_fee_verified_orders,
  count(*) filter(where external_listing_id is null)::integer unassigned_orders,
  count(*) filter(where external_listing_id=(select listing_external from bounds))::integer listing_orders,
  count(*) filter(where external_listing_id=(select listing_external from bounds) and fee_valid)::integer verified_listing_orders,
  coalesce(round(sum(product_revenue) filter(where external_listing_id=(select listing_external from bounds) and fee_valid),2),0)::numeric subtotal,
  coalesce(round(sum(seller_discount) filter(where external_listing_id=(select listing_external from bounds) and fee_valid),2),0)::numeric seller_discount,
  coalesce(round(sum(transaction_fee) filter(where external_listing_id=(select listing_external from bounds) and fee_valid),2),0)::numeric transaction_fee,
  coalesce(round(sum(commission_net) filter(where external_listing_id=(select listing_external from bounds) and fee_valid),2),0)::numeric commission_net,
  coalesce(round(sum(service_net) filter(where external_listing_id=(select listing_external from bounds) and fee_valid),2),0)::numeric service_net
 from classified
)
select jsonb_build_object(
 'period_start',(select start_date from bounds),
 'period_end',(select end_date from bounds),
 'financial_source_available',all_finance_orders>0,
 'listing_orders',listing_orders,
 'verified_listing_orders',verified_listing_orders,
 'all_finance_orders',all_finance_orders,
 'all_fee_verified_orders',all_fee_verified_orders,
 'unassigned_orders',unassigned_orders,
 'overlapping_orders',overlapping_orders,
 'subtotal_verified_orders',subtotal,
 'seller_discount_informational',seller_discount,
 'transaction_fee',transaction_fee,
 'commission_net',commission_net,
 'service_net',service_net,
 'after_identified_fees',round(subtotal-transaction_fee-commission_net-service_net,2),
 'seller_discount_already_reflected',true,
 'is_final_payout',false
) from sums
$fn$;
revoke all on function public.commerce_shopee_listing_finance_v1(text,integer,text)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_listing_finance_v1(text,integer,text)
 to service_role;
