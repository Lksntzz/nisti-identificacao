CREATE OR REPLACE FUNCTION public.commerce_commit_sales_import_v1(p_batch_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_batch public.commerce_sales_import_batches%rowtype;
  v_old_snapshot bigint;
  v_new_snapshot bigint;
  v_rows integer;
  v_summaries integer;
  v_part_match text[];
  v_part_count integer := 1;
  v_group_key text := null;
  v_group_batch_ids bigint[] := ARRAY[p_batch_id];
  v_parts_found integer := 1;
BEGIN
  SELECT * INTO v_batch
  FROM public.commerce_sales_import_batches
  WHERE id=p_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sales_import_batch_not_found' USING errcode='22023';
  END IF;

  IF v_batch.status='COMMITTED' AND v_batch.snapshot_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status','COMMITTED',
      'batch_id',v_batch.id,
      'snapshot_id',v_batch.snapshot_id,
      'already_committed',true
    );
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM public.commerce_sales_import_stage_rows WHERE batch_id=p_batch_id
  ) THEN
    RAISE EXCEPTION 'sales_import_no_rows' USING errcode='22023';
  END IF;

  v_part_match := regexp_match(
    v_batch.source_filename,
    '_part_([0-9]+)_of_([0-9]+)[.]xlsx$',
    'i'
  );

  IF v_part_match IS NOT NULL THEN
    v_part_count := greatest(v_part_match[2]::integer, 1);
    v_group_key := regexp_replace(
      v_batch.source_filename,
      '_part_[0-9]+_of_[0-9]+[.]xlsx$',
      '.xlsx',
      'i'
    );

    SELECT
      coalesce(array_agg(chosen.id ORDER BY chosen.part_no), ARRAY[]::bigint[]),
      count(*)::integer
    INTO v_group_batch_ids, v_parts_found
    FROM (
      SELECT DISTINCT ON (candidate.part_no)
        candidate.id,
        candidate.part_no
      FROM (
        SELECT
          b.id,
          ((regexp_match(
            b.source_filename,
            '_part_([0-9]+)_of_([0-9]+)[.]xlsx$',
            'i'
          ))[1])::integer AS part_no
        FROM public.commerce_sales_import_batches b
        WHERE b.platform_code=v_batch.platform_code
          AND b.status='STAGED'
          AND regexp_replace(
            b.source_filename,
            '_part_[0-9]+_of_[0-9]+[.]xlsx$',
            '.xlsx',
            'i'
          )=v_group_key
          AND coalesce(
            ((regexp_match(
              b.source_filename,
              '_part_([0-9]+)_of_([0-9]+)[.]xlsx$',
              'i'
            ))[2])::integer,
            0
          )=v_part_count
      ) candidate
      WHERE candidate.part_no BETWEEN 1 AND v_part_count
      ORDER BY candidate.part_no, candidate.id DESC
    ) chosen;

    IF v_parts_found < v_part_count THEN
      RETURN jsonb_build_object(
        'status','WAITING_PARTS',
        'batch_id',p_batch_id,
        'multipart_group',v_group_key,
        'parts_received',v_parts_found,
        'parts_expected',v_part_count,
        'missing_parts',(
          SELECT coalesce(jsonb_agg(part_no ORDER BY part_no),'[]'::jsonb)
          FROM generate_series(1,v_part_count) part_no
          WHERE NOT EXISTS(
            SELECT 1
            FROM unnest(v_group_batch_ids) batch_id
            JOIN public.commerce_sales_import_batches b ON b.id=batch_id
            WHERE ((regexp_match(
              b.source_filename,
              '_part_([0-9]+)_of_([0-9]+)[.]xlsx$',
              'i'
            ))[1])::integer=part_no
          )
        )
      );
    END IF;
  END IF;

  SELECT id INTO v_old_snapshot
  FROM public.commerce_sales_snapshots
  WHERE is_current=true
  ORDER BY id DESC
  LIMIT 1;

  IF v_part_count=1 AND EXISTS(
    WITH incoming_months AS (
      SELECT date_trunc('month',period_start)::date AS month_start,
             max(period_end)::date AS incoming_end
      FROM public.commerce_sales_import_stage_rows
      WHERE batch_id=ANY(v_group_batch_ids)
      GROUP BY 1
    ),
    existing_months AS (
      SELECT date_trunc('month',period_start)::date AS month_start,
             max(period_end)::date AS existing_end
      FROM public.commerce_sales_rows
      WHERE snapshot_id=v_old_snapshot
        AND platform_code=v_batch.platform_code
      GROUP BY 1
    )
    SELECT 1
    FROM incoming_months i
    JOIN existing_months e USING(month_start)
    WHERE i.incoming_end < e.existing_end
  ) THEN
    RAISE EXCEPTION 'sales_import_period_regression'
      USING errcode='22023',
            detail='A importação termina antes do período já salvo para o mesmo mês e plataforma.';
  END IF;

  INSERT INTO public.commerce_sales_snapshots(
    source_name,source_ref,data_through,row_count,summary_row_count,is_current,created_by
  ) VALUES(
    'IMPORTAÇÃO COMERCIAL',
    CASE
      WHEN v_part_count>1 THEN 'sales-import-group:'||coalesce(v_group_key,p_batch_id::text)
      ELSE 'sales-import:'||p_batch_id::text
    END,
    (SELECT max(period_end)
     FROM public.commerce_sales_import_stage_rows
     WHERE batch_id=ANY(v_group_batch_ids)),
    0,0,false,
    v_batch.created_by
  )
  RETURNING id INTO v_new_snapshot;

  WITH incoming_base AS (
    SELECT
      date_trunc('month',r.period_start)::date AS month_start,
      r.period_end,r.sku_primary,r.sku,r.sku_norm,r.product_name,r.variation,
      r.units,r.orders_with_item,r.product_revenue
    FROM public.commerce_sales_import_stage_rows r
    WHERE r.batch_id=ANY(v_group_batch_ids)
  ),
  incoming_months AS (
    SELECT month_start,max(period_end)::date AS period_end
    FROM incoming_base
    GROUP BY month_start
  ),
  incoming_rows AS (
    SELECT
      b.month_start,
      m.period_end,
      CASE
        WHEN m.period_end=(b.month_start + interval '1 month - 1 day')::date
          THEN to_char(b.month_start,'YYYY-MM')
        ELSE to_char(b.month_start,'YYYY-MM')||' (01-'||to_char(m.period_end,'DD')||')'
      END AS period_key,
      b.sku_primary,b.sku,b.sku_norm,
      max(b.product_name) AS product_name,
      max(b.variation) AS variation,
      sum(b.units)::integer AS units,
      sum(b.orders_with_item)::integer AS orders_with_item,
      round(sum(b.product_revenue),2) AS product_revenue
    FROM incoming_base b
    JOIN incoming_months m USING(month_start)
    GROUP BY b.month_start,m.period_end,b.sku_primary,b.sku,b.sku_norm
  ),
  combined AS (
    SELECT
      r.platform_code,r.period_key,r.period_start,r.period_end,r.sku_primary,r.sku,r.sku_norm,
      r.product_name,r.variation,r.units,r.orders_with_item,r.product_revenue,0 AS source_order
    FROM public.commerce_sales_rows r
    WHERE r.snapshot_id=v_old_snapshot
      AND NOT (
        r.platform_code=v_batch.platform_code
        AND EXISTS(
          SELECT 1 FROM incoming_months p
          WHERE p.month_start=date_trunc('month',r.period_start)::date
        )
      )

    UNION ALL

    SELECT
      v_batch.platform_code,r.period_key,r.month_start,r.period_end,r.sku_primary,r.sku,r.sku_norm,
      r.product_name,r.variation,r.units,r.orders_with_item,r.product_revenue,1 AS source_order
    FROM incoming_rows r
  ),
  numbered AS (
    SELECT row_number() OVER(
      ORDER BY platform_code,period_start,sku_norm,coalesce(sku_primary,''),sku,source_order
    )::integer AS source_row_number,*
    FROM combined
  )
  INSERT INTO public.commerce_sales_rows(
    snapshot_id,source_row_number,platform_code,period_key,period_start,period_end,
    sku_primary,sku,sku_norm,product_name,variation,units,orders_with_item,product_revenue
  )
  SELECT
    v_new_snapshot,source_row_number,platform_code,period_key,period_start,period_end,
    sku_primary,sku,sku_norm,product_name,variation,units,orders_with_item,product_revenue
  FROM numbered;

  WITH incoming_months AS (
    SELECT date_trunc('month',period_start)::date AS month_start,
           max(period_end)::date AS period_end
    FROM public.commerce_sales_import_stage_rows
    WHERE batch_id=ANY(v_group_batch_ids)
    GROUP BY 1
  )
  INSERT INTO public.commerce_sales_summary_rows(
    snapshot_id,platform_code,period_key,period_start,period_end,net_orders,units,
    product_revenue,listings_with_sales,skus_with_sales
  )
  SELECT
    v_new_snapshot,s.platform_code,s.period_key,s.period_start,s.period_end,s.net_orders,s.units,
    s.product_revenue,s.listings_with_sales,s.skus_with_sales
  FROM public.commerce_sales_summary_rows s
  WHERE s.snapshot_id=v_old_snapshot
    AND NOT (
      s.platform_code=v_batch.platform_code
      AND EXISTS(
        SELECT 1 FROM incoming_months p
        WHERE p.month_start=date_trunc('month',s.period_start)::date
      )
    );

  WITH summary_base AS (
    SELECT
      date_trunc('month',s.period_start)::date AS month_start,
      max(s.period_end)::date AS period_end,
      sum(s.net_orders)::integer AS net_orders,
      sum(s.units)::integer AS units,
      round(sum(s.product_revenue),2) AS product_revenue
    FROM public.commerce_sales_import_stage_summary s
    WHERE s.batch_id=ANY(v_group_batch_ids)
    GROUP BY 1
  ),
  row_counts AS (
    SELECT
      date_trunc('month',r.period_start)::date AS month_start,
      count(distinct coalesce(nullif(btrim(coalesce(r.sku_primary,'')),''),r.sku))::integer AS listings_with_sales,
      count(distinct r.sku_norm)::integer AS skus_with_sales
    FROM public.commerce_sales_import_stage_rows r
    WHERE r.batch_id=ANY(v_group_batch_ids)
    GROUP BY 1
  )
  INSERT INTO public.commerce_sales_summary_rows(
    snapshot_id,platform_code,period_key,period_start,period_end,net_orders,units,
    product_revenue,listings_with_sales,skus_with_sales
  )
  SELECT
    v_new_snapshot,
    v_batch.platform_code,
    CASE
      WHEN s.period_end=(s.month_start + interval '1 month - 1 day')::date
        THEN to_char(s.month_start,'YYYY-MM')
      ELSE to_char(s.month_start,'YYYY-MM')||' (01-'||to_char(s.period_end,'DD')||')'
    END,
    s.month_start,s.period_end,s.net_orders,s.units,s.product_revenue,
    c.listings_with_sales,c.skus_with_sales
  FROM summary_base s
  LEFT JOIN row_counts c USING(month_start);

  WITH missing_months AS (
    SELECT
      date_trunc('month',r.period_start)::date AS month_start,
      max(r.period_end)::date AS period_end
    FROM public.commerce_sales_import_stage_rows r
    WHERE r.batch_id=ANY(v_group_batch_ids)
      AND NOT EXISTS(
        SELECT 1
        FROM public.commerce_sales_import_stage_summary s
        WHERE s.batch_id=ANY(v_group_batch_ids)
          AND date_trunc('month',s.period_start)::date=date_trunc('month',r.period_start)::date
      )
    GROUP BY 1
  )
  INSERT INTO public.commerce_sales_summary_rows(
    snapshot_id,platform_code,period_key,period_start,period_end,net_orders,units,
    product_revenue,listings_with_sales,skus_with_sales
  )
  SELECT
    v_new_snapshot,
    v_batch.platform_code,
    CASE
      WHEN m.period_end=(m.month_start + interval '1 month - 1 day')::date
        THEN to_char(m.month_start,'YYYY-MM')
      ELSE to_char(m.month_start,'YYYY-MM')||' (01-'||to_char(m.period_end,'DD')||')'
    END,
    m.month_start,m.period_end,
    sum(r.orders_with_item)::integer,
    sum(r.units)::integer,
    round(sum(r.product_revenue),2),
    count(distinct coalesce(nullif(btrim(coalesce(r.sku_primary,'')),''),r.sku))::integer,
    count(distinct r.sku_norm)::integer
  FROM missing_months m
  JOIN public.commerce_sales_import_stage_rows r
    ON r.batch_id=ANY(v_group_batch_ids)
   AND date_trunc('month',r.period_start)::date=m.month_start
  GROUP BY m.month_start,m.period_end;

  SELECT count(*) INTO v_rows
  FROM public.commerce_sales_rows
  WHERE snapshot_id=v_new_snapshot;

  SELECT count(*) INTO v_summaries
  FROM public.commerce_sales_summary_rows
  WHERE snapshot_id=v_new_snapshot;

  UPDATE public.commerce_sales_snapshots
  SET
    row_count=v_rows,
    summary_row_count=v_summaries,
    data_through=(
      SELECT max(period_end)
      FROM public.commerce_sales_summary_rows
      WHERE snapshot_id=v_new_snapshot
    )
  WHERE id=v_new_snapshot;

  UPDATE public.commerce_sales_snapshots
  SET is_current=false
  WHERE is_current=true AND id<>v_new_snapshot;

  UPDATE public.commerce_sales_snapshots
  SET is_current=true
  WHERE id=v_new_snapshot;

  UPDATE public.commerce_sales_import_batches
  SET status='COMMITTED',snapshot_id=v_new_snapshot,committed_at=now()
  WHERE id=ANY(v_group_batch_ids);

  RETURN jsonb_build_object(
    'status','COMMITTED',
    'batch_id',p_batch_id,
    'snapshot_id',v_new_snapshot,
    'rows',v_rows,
    'summary_rows',v_summaries,
    'merged_parts',CASE WHEN v_part_count>1 THEN v_part_count ELSE 1 END,
    'multipart_group',v_group_key,
    'replaced_months',(
      SELECT coalesce(jsonb_agg(month_key ORDER BY month_key),'[]'::jsonb)
      FROM (
        SELECT DISTINCT to_char(date_trunc('month',period_start),'YYYY-MM') AS month_key
        FROM public.commerce_sales_import_stage_rows
        WHERE batch_id=ANY(v_group_batch_ids)
      ) m
    ),
    'data_through',(SELECT data_through FROM public.commerce_sales_snapshots WHERE id=v_new_snapshot)
  );
EXCEPTION WHEN OTHERS THEN
  UPDATE public.commerce_sales_import_batches
  SET status='FAILED'
  WHERE id=p_batch_id AND status<>'COMMITTED';
  RAISE;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.commerce_commit_sales_import_v1(bigint)
FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_commit_sales_import_v1(bigint)
TO service_role;
