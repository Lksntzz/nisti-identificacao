-- Recover order fees from exact files already imported, without reimporting
-- order quantities, revenue, or touching snapshots. File SHA is cross-checked
-- against the original committed sales import; only an admin route may call.
create or replace function public.commerce_shopee_finance_backfill_source_v1(
 p_filename text,p_sha256 text)
returns jsonb language sql stable security invoker set search_path=public as $fn$
select coalesce((
 select jsonb_build_object('batch_id',b.id,'filename',b.source_filename,
   'snapshot_id',b.snapshot_id)
 from public.commerce_sales_import_batches b
 where b.platform_code='SHOPEE' and b.status='COMMITTED'
  and b.source_filename=p_filename
  and b.source_sha256=p_sha256 and length(p_sha256)=64
  and exists(select 1 from public.commerce_sales_import_stage_rows r
      where r.batch_id=b.id)
 order by b.id desc limit 1
),jsonb_build_object('error','A planilha não corresponde a uma importação de vendas confirmada.'));
$fn$;

create or replace function public.commerce_shopee_finance_backfill_activate_v1(
 p_batch_id bigint,p_source_sha256 text)
returns jsonb language plpgsql volatile security invoker set search_path=public as $fn$
declare v_filename text;v_group text;v_expected integer:=1;
 v_count integer;v_ids bigint[];v_current_snapshot bigint;
 v_month date;v_sales_group text;v_sales_snapshot bigint;v_activated integer:=0;
 v_units bigint;v_revenue numeric;v_orders integer;v_actual_units bigint;
 v_actual_revenue numeric;v_actual_orders integer;
begin
 select b.source_filename into v_filename from public.commerce_sales_import_batches b
 where b.id=p_batch_id and b.platform_code='SHOPEE' and b.status='COMMITTED'
   and length(p_source_sha256)=64 and lower(b.source_sha256)=lower(p_source_sha256);
 if v_filename is null then
  raise exception 'O SHA-256 do arquivo não corresponde a uma venda importada.';end if;
 perform pg_advisory_xact_lock(2026,2987);
 v_group:=regexp_replace(v_filename,'_part_[0-9]+_of_[0-9]+[.]xlsx$','.xlsx','i');
 v_expected:=coalesce(((regexp_match(v_filename,
   '_part_([0-9]+)_of_([0-9]+)[.]xlsx$','i'))[2])::integer,1);
 with candidates as (
   select b.id,
   coalesce(((regexp_match(b.source_filename,
     '_part_([0-9]+)_of_([0-9]+)[.]xlsx$','i'))[1])::integer,1) part
   from public.commerce_sales_import_batches b
   where b.platform_code='SHOPEE' and b.status='COMMITTED'
    and regexp_replace(b.source_filename,
      '_part_[0-9]+_of_[0-9]+[.]xlsx$','.xlsx','i')=v_group
    and exists(select 1 from public.commerce_shopee_finance_stage_month_v1 m
      where m.batch_id=b.id)
 ), picked as (
   select distinct on(part) id,part from candidates
   where part between 1 and v_expected order by part,id desc
 )
 select count(*)::integer,array_agg(id order by part) into v_count,v_ids
 from picked;
 if v_count<v_expected then
  return jsonb_build_object('status','WAITING_PARTS','parts_received',v_count,
   'parts_expected',v_expected);
 end if;
 select id into v_current_snapshot from public.commerce_sales_snapshots
 where is_current order by id desc limit 1;
 if v_current_snapshot is null then raise exception 'Snapshot de vendas ausente.';end if;
 for v_month,v_units,v_revenue,v_orders in
  select m.month_start,sum(m.units)::bigint,round(sum(m.product_revenue),2),
    sum(m.orders)::integer
  from public.commerce_shopee_finance_stage_month_v1 m
  where m.batch_id=any(v_ids) group by m.month_start
 loop
   select regexp_replace(b.source_filename,
       '_part_[0-9]+_of_[0-9]+[.]xlsx$','.xlsx','i'),b.snapshot_id
     into v_sales_group,v_sales_snapshot
   from public.commerce_sales_import_batches b
   join public.commerce_sales_import_stage_rows r on r.batch_id=b.id
   where b.platform_code='SHOPEE' and b.status='COMMITTED'
    and date_trunc('month',r.period_start)::date=v_month
   order by b.committed_at desc nulls last,b.id desc limit 1;
   if v_sales_group is distinct from v_group then
     raise exception 'A planilha é anterior ao arquivo que atualizou esse mês.';end if;
   select sum(s.units),round(sum(s.product_revenue),2),sum(s.net_orders)::integer
      into v_actual_units,v_actual_revenue,v_actual_orders
   from public.commerce_sales_summary_rows s
   where s.snapshot_id=v_current_snapshot and s.platform_code='SHOPEE'
    and date_trunc('month',s.period_start)::date=v_month;
   if v_actual_units is distinct from v_units
     or abs(coalesce(v_actual_revenue,0)-v_revenue)>0.01
     or v_actual_orders is distinct from v_orders then
     raise exception 'Taxas não reconciliam com as vendas importadas de %.',v_month;end if;
   if exists(
     select 1 from (
       select sum(m.unallocated_units) unallocated_units,
        sum(m.unallocated_revenue) unallocated_revenue,
        sum(m.single_sku_fee_orders) attributed_orders
       from public.commerce_shopee_finance_stage_month_v1 m
       where m.batch_id=any(v_ids) and m.month_start=v_month
     ) x cross join lateral (
       select coalesce(sum(d.units),0) units,
        coalesce(sum(d.product_revenue),0) revenue,
        coalesce(sum(d.orders),0) orders
       from public.commerce_shopee_finance_stage_daily_v1 d
       where d.batch_id=any(v_ids)
        and date_trunc('month',d.sale_date)::date=v_month
     ) y
     where x.unallocated_units+y.units<>v_units
       or abs(x.unallocated_revenue+y.revenue-v_revenue)>0.01
       or x.attributed_orders<>y.orders
   ) then raise exception 'Atribuição financeira incompleta para %.',v_month;end if;
   delete from public.commerce_shopee_finance_month_v1 where month_start=v_month;
   insert into public.commerce_shopee_finance_month_v1(
      month_start,source_snapshot_id,orders,units,product_revenue,seller_discount,
      commission_net,service_net,transaction_fee,fee_orders,single_sku_fee_orders,
      unallocated_orders,unallocated_units,unallocated_revenue)
   select v_month,v_sales_snapshot,sum(orders),sum(units),sum(product_revenue),
      sum(seller_discount),sum(commission_net),sum(service_net),sum(transaction_fee),
      sum(fee_orders),sum(single_sku_fee_orders),sum(unallocated_orders),
      sum(unallocated_units),sum(unallocated_revenue)
   from public.commerce_shopee_finance_stage_month_v1 where batch_id=any(v_ids)
    and month_start=v_month;
   insert into public.commerce_shopee_finance_daily_v1(
    sale_date,sku_norm,month_start,source_snapshot_id,orders,units,
    product_revenue,seller_discount,commission_net,service_net,transaction_fee)
   select sale_date,sku_norm,v_month,v_sales_snapshot,sum(orders),sum(units),
    sum(product_revenue),sum(seller_discount),sum(commission_net),sum(service_net),
    sum(transaction_fee)
   from public.commerce_shopee_finance_stage_daily_v1
   where batch_id=any(v_ids) and date_trunc('month',sale_date)::date=v_month
   group by sale_date,sku_norm;
   v_activated:=v_activated+1;
 end loop;
 return jsonb_build_object('status','COMMITTED','finance_months',v_activated,
  'scope','SINGLE_SKU_ORDERS_ONLY','sales_rows_modified',false);
end $fn$;
revoke all on function public.commerce_shopee_finance_backfill_source_v1(text,text)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_finance_backfill_source_v1(text,text)
 to service_role;
revoke all on function public.commerce_shopee_finance_backfill_activate_v1(bigint,text)
 from public,anon,authenticated;
grant execute on function public.commerce_shopee_finance_backfill_activate_v1(bigint,text)
 to service_role;
