CREATE OR REPLACE FUNCTION public.commerce_commit_sales_import_v1(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_batch public.commerce_sales_import_batches%rowtype;
  v_old_snapshot bigint;
  v_new_snapshot bigint;
  v_rows integer;
  v_summaries integer;
begin
  select * into v_batch
  from public.commerce_sales_import_batches
  where id=p_batch_id
  for update;

  if not found then
    raise exception 'sales_import_batch_not_found' using errcode='22023';
  end if;
  if v_batch.status='COMMITTED' and v_batch.snapshot_id is not null then
    return jsonb_build_object(
      'status','COMMITTED','batch_id',v_batch.id,'snapshot_id',v_batch.snapshot_id,
      'already_committed',true
    );
  end if;

  select id into v_old_snapshot
  from public.commerce_sales_snapshots
  where is_current=true
  order by id desc
  limit 1;

  if not exists(select 1 from public.commerce_sales_import_stage_rows where batch_id=p_batch_id) then
    raise exception 'sales_import_no_rows' using errcode='22023';
  end if;

  -- Não permite que uma importação menos completa reduza a cobertura já gravada para o mesmo mês.
  if exists(
    with incoming_months as (
      select
        date_trunc('month',period_start)::date as month_start,
        max(period_end)::date as incoming_end
      from public.commerce_sales_import_stage_rows
      where batch_id=p_batch_id
      group by 1
    ),
    existing_months as (
      select
        date_trunc('month',period_start)::date as month_start,
        max(period_end)::date as existing_end
      from public.commerce_sales_rows
      where snapshot_id=v_old_snapshot
        and platform_code=v_batch.platform_code
      group by 1
    )
    select 1
    from incoming_months i
    join existing_months e using(month_start)
    where i.incoming_end < e.existing_end
  ) then
    raise exception 'sales_import_period_regression'
      using errcode='22023',
            detail='A importação termina antes do período já salvo para o mesmo mês e plataforma.';
  end if;

  insert into public.commerce_sales_snapshots(
    source_name,source_ref,data_through,row_count,summary_row_count,is_current,created_by
  ) values(
    'IMPORTAÇÃO COMERCIAL',
    'sales-import:'||p_batch_id::text,
    v_batch.data_through,
    0,0,false,
    v_batch.created_by
  )
  returning id into v_new_snapshot;

  with imported_months as (
    select distinct date_trunc('month',period_start)::date as month_start
    from public.commerce_sales_import_stage_rows
    where batch_id=p_batch_id
  ),
  combined as (
    select
      r.platform_code,r.period_key,r.period_start,r.period_end,r.sku_primary,r.sku,r.sku_norm,
      r.product_name,r.variation,r.units,r.orders_with_item,r.product_revenue,
      0 as source_order
    from public.commerce_sales_rows r
    where r.snapshot_id=v_old_snapshot
      and not (
        r.platform_code=v_batch.platform_code
        and exists(
          select 1
          from imported_months p
          where p.month_start=date_trunc('month',r.period_start)::date
        )
      )

    union all

    select
      v_batch.platform_code,r.period_key,r.period_start,r.period_end,r.sku_primary,r.sku,r.sku_norm,
      r.product_name,r.variation,r.units,r.orders_with_item,r.product_revenue,
      1 as source_order
    from public.commerce_sales_import_stage_rows r
    where r.batch_id=p_batch_id
  ),
  numbered as (
    select row_number() over(
      order by platform_code,period_start,sku_norm,coalesce(sku_primary,''),sku,source_order
    )::integer as source_row_number,*
    from combined
  )
  insert into public.commerce_sales_rows(
    snapshot_id,source_row_number,platform_code,period_key,period_start,period_end,
    sku_primary,sku,sku_norm,product_name,variation,units,orders_with_item,product_revenue
  )
  select
    v_new_snapshot,source_row_number,platform_code,period_key,period_start,period_end,
    sku_primary,sku,sku_norm,product_name,variation,units,orders_with_item,product_revenue
  from numbered;

  with imported_months as (
    select distinct date_trunc('month',period_start)::date as month_start
    from public.commerce_sales_import_stage_rows
    where batch_id=p_batch_id
  )
  insert into public.commerce_sales_summary_rows(
    snapshot_id,platform_code,period_key,period_start,period_end,net_orders,units,
    product_revenue,listings_with_sales,skus_with_sales
  )
  select
    v_new_snapshot,s.platform_code,s.period_key,s.period_start,s.period_end,s.net_orders,s.units,
    s.product_revenue,s.listings_with_sales,s.skus_with_sales
  from public.commerce_sales_summary_rows s
  where s.snapshot_id=v_old_snapshot
    and not (
      s.platform_code=v_batch.platform_code
      and exists(
        select 1
        from imported_months p
        where p.month_start=date_trunc('month',s.period_start)::date
      )
    )

  union all

  select
    v_new_snapshot,v_batch.platform_code,s.period_key,s.period_start,s.period_end,s.net_orders,s.units,
    s.product_revenue,s.listings_with_sales,s.skus_with_sales
  from public.commerce_sales_import_stage_summary s
  where s.batch_id=p_batch_id;

  -- Fallback de resumo para períodos que não receberam summary explícito.
  insert into public.commerce_sales_summary_rows(
    snapshot_id,platform_code,period_key,period_start,period_end,net_orders,units,
    product_revenue,listings_with_sales,skus_with_sales
  )
  select
    v_new_snapshot,
    v_batch.platform_code,
    r.period_key,
    min(r.period_start),
    max(r.period_end),
    sum(r.orders_with_item)::integer,
    sum(r.units)::integer,
    round(sum(r.product_revenue),2),
    count(*)::integer,
    count(distinct r.sku_norm)::integer
  from public.commerce_sales_import_stage_rows r
  where r.batch_id=p_batch_id
    and not exists(
      select 1
      from public.commerce_sales_import_stage_summary s
      where s.batch_id=p_batch_id and s.period_key=r.period_key
    )
  group by r.period_key;

  select count(*) into v_rows
  from public.commerce_sales_rows
  where snapshot_id=v_new_snapshot;

  select count(*) into v_summaries
  from public.commerce_sales_summary_rows
  where snapshot_id=v_new_snapshot;

  update public.commerce_sales_snapshots
  set
    row_count=v_rows,
    summary_row_count=v_summaries,
    data_through=(
      select max(period_end)
      from public.commerce_sales_summary_rows
      where snapshot_id=v_new_snapshot
    )
  where id=v_new_snapshot;

  update public.commerce_sales_snapshots
  set is_current=false
  where is_current=true and id<>v_new_snapshot;

  update public.commerce_sales_snapshots
  set is_current=true
  where id=v_new_snapshot;

  update public.commerce_sales_import_batches
  set
    status='COMMITTED',
    snapshot_id=v_new_snapshot,
    committed_at=now()
  where id=p_batch_id;

  return jsonb_build_object(
    'status','COMMITTED',
    'batch_id',p_batch_id,
    'snapshot_id',v_new_snapshot,
    'rows',v_rows,
    'summary_rows',v_summaries,
    'replaced_months',(
      select coalesce(jsonb_agg(month_key order by month_key),'[]'::jsonb)
      from (
        select distinct to_char(date_trunc('month',period_start),'YYYY-MM') as month_key
        from public.commerce_sales_import_stage_rows
        where batch_id=p_batch_id
      ) m
    ),
    'data_through',(select data_through from public.commerce_sales_snapshots where id=v_new_snapshot)
  );
exception when others then
  update public.commerce_sales_import_batches
  set status='FAILED'
  where id=p_batch_id and status<>'COMMITTED';
  raise;
end;
$function$;

revoke execute on function public.commerce_commit_sales_import_v1(bigint)
from public,anon,authenticated;
grant execute on function public.commerce_commit_sales_import_v1(bigint)
to service_role;
