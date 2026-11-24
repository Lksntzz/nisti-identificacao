-- Definição ANTERIOR (a que está em produção hoje) da view commerce_current_sales_listing_daily_v1, copiada do catálogo
-- (somente leitura). Usada no teste para (a) montar o estado inicial e (b) reproduzir o descarte de partes do mesmo dia.
-- No Mercado Livre ela escolhe UM único lote por dia (DISTINCT ON ... committed_at DESC), então as outras partes somem.
create table if not exists public.commerce_shopee_sku_owner_reviewed_v1 (
  source_sku_norm text, canonical_sku_norm text, external_listing_id text);

create or replace view public.commerce_current_sales_listing_daily_v1 as
 WITH base_days AS (
         SELECT DISTINCT ON (b.platform_code, d.sale_date) b.platform_code,
            d.sale_date,
            b.id AS batch_id
           FROM commerce_sales_import_batches b
             JOIN commerce_sales_import_stage_summary s ON s.batch_id = b.id AND s.period_start = s.period_end
             JOIN commerce_sales_listing_daily_v1 d ON d.batch_id = b.id AND d.sale_date = s.period_start
          WHERE b.status = 'COMMITTED'::text
          ORDER BY b.platform_code, d.sale_date, b.committed_at DESC, b.id DESC
        ), native_rows AS (
         SELECT bd.platform_code,
            d.sale_date,
            d.external_listing_id,
            d.sku_norm,
            d.units,
            d.orders_with_item,
            d.product_revenue
           FROM base_days bd
             JOIN commerce_sales_listing_daily_v1 d ON d.batch_id = bd.batch_id AND d.sale_date = bd.sale_date
        ), sku_source AS (
         SELECT d.sale_date,
            d.sku_norm,
            d.units,
            d.orders_with_item,
            d.product_revenue,
            COALESCE(b.snapshot_id, 0::bigint) AS snapshot_id
           FROM commerce_shopee_sales_sku_daily_v1 d
             JOIN commerce_sales_import_batches b ON b.id = d.batch_id
          WHERE b.platform_code = 'SHOPEE'::text AND b.status = 'COMMITTED'::text
        ), most_recent AS (
         SELECT sku_source.sale_date,
            max(sku_source.snapshot_id) AS snapshot_id
           FROM sku_source
          GROUP BY sku_source.sale_date
        ), current_sku AS (
         SELECT s.sale_date,
            s.sku_norm,
            sum(s.units)::integer AS units,
            sum(s.orders_with_item)::integer AS orders_with_item,
            round(sum(s.product_revenue), 2)::numeric(14,2) AS product_revenue
           FROM sku_source s
             JOIN most_recent v ON v.sale_date = s.sale_date AND v.snapshot_id = s.snapshot_id
          GROUP BY s.sale_date, s.sku_norm
        ), sku_owner AS (
         SELECT commerce_shopee_sku_owner_reviewed_v1.source_sku_norm,
            commerce_shopee_sku_owner_reviewed_v1.canonical_sku_norm,
            commerce_shopee_sku_owner_reviewed_v1.external_listing_id
           FROM commerce_shopee_sku_owner_reviewed_v1
        ), matched_sku AS (
         SELECT 'SHOPEE'::text AS platform_code,
            s.sale_date,
            o.external_listing_id,
            o.canonical_sku_norm AS sku_norm,
            s.units,
            s.orders_with_item,
            s.product_revenue
           FROM current_sku s
             JOIN sku_owner o ON o.source_sku_norm = s.sku_norm
          WHERE NOT (EXISTS ( SELECT 1
                   FROM native_rows n
                  WHERE n.platform_code = 'SHOPEE'::text AND n.sale_date = s.sale_date))
        )
 SELECT native_rows.platform_code,
    native_rows.sale_date,
    native_rows.external_listing_id,
    native_rows.sku_norm,
    native_rows.units,
    native_rows.orders_with_item,
    native_rows.product_revenue
   FROM native_rows
UNION ALL
 SELECT matched_sku.platform_code,
    matched_sku.sale_date,
    matched_sku.external_listing_id,
    matched_sku.sku_norm,
    matched_sku.units,
    matched_sku.orders_with_item,
    matched_sku.product_revenue
   FROM matched_sku;
