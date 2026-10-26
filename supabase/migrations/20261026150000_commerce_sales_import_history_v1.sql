-- Somente leitura. Historico das importacoes de vendas por plataforma.
-- Periodo: 1) datas no nome do arquivo (AAAAMMDD_AAAAMMDD), 2) resumo gravado, 3) vendas diarias do lote.
-- O resumo da Shopee pode rotular o mes inteiro; por isso o nome do arquivo tem prioridade.
create or replace function public.commerce_sales_import_history_v1(
  p_platform text default 'TODAS', p_limit integer default 20, p_offset integer default 0
) returns jsonb
language sql stable security invoker set search_path=public
as $function$
with params as (
  select case when upper(coalesce(p_platform,'TODAS')) in ('SHOPEE','ML_ANTIGO','ML_NOVO')
    then upper(p_platform) else null end platform,
    greatest(1,least(coalesce(p_limit,20),100)) lim, greatest(0,coalesce(p_offset,0)) off
), base as (
  select b.* from public.commerce_sales_import_batches b, params p
  where p.platform is null or b.platform_code=p.platform
), summ as (
  select s.batch_id,min(s.period_start) ps,max(s.period_end) pe,sum(s.net_orders) orders,
    sum(s.units) units,sum(s.product_revenue) revenue,
    max(s.listings_with_sales) listings,max(s.skus_with_sales) skus
  from public.commerce_sales_import_stage_summary s
  where s.batch_id in (select id from base) group by s.batch_id
), daily as (
  select x.batch_id,min(x.d) dmin,max(x.d) dmax,sum(x.u) units,sum(x.r) revenue from (
    select batch_id,sale_date d,units u,product_revenue r from public.commerce_sales_listing_daily_v1
    union all
    select batch_id,sale_date,units,product_revenue from public.commerce_shopee_sales_sku_daily_v1
  ) x where x.batch_id in (select id from base) group by x.batch_id
), named as (
  select b.id,
    (regexp_match(b.source_filename,'(20\d{2})(\d{2})(\d{2})_(20\d{2})(\d{2})(\d{2})'))[1:6] m
  from base b
), items as (
  select b.id batch_id,b.platform_code,b.source_filename,b.status,b.data_through,
    b.staged_row_count rows_count,b.created_by,b.created_at,b.committed_at,
    case when n.m is not null then make_date(n.m[1]::int,n.m[2]::int,n.m[3]::int)
         else coalesce(s.ps,d.dmin) end period_start,
    case when n.m is not null then make_date(n.m[4]::int,n.m[5]::int,n.m[6]::int)
         else coalesce(s.pe,d.dmax) end period_end,
    case when n.m is not null then 'FILENAME' when s.ps is not null then 'SUMMARY'
         when d.dmin is not null then 'DAILY' else null end period_source,
    coalesce(s.orders,null) orders,coalesce(s.units,d.units) units,
    round(coalesce(s.revenue,d.revenue),2) revenue,s.listings,s.skus
  from base b
  left join summ s on s.batch_id=b.id
  left join daily d on d.batch_id=b.id
  left join named n on n.id=b.id
), page as (
  select i.* from items i,params p order by i.created_at desc,i.batch_id desc limit (select lim from params) offset (select off from params)
), cover as (
  select v.platform_code,min(v.sale_date) first_day,max(v.sale_date) last_day,
    count(distinct v.sale_date) days_with_sales,
    (max(v.sale_date)-min(v.sale_date)+1)-count(distinct v.sale_date) days_without_sales,
    sum(v.units) units,round(sum(v.product_revenue),2) revenue
  from public.commerce_current_sales_listing_daily_v1 v group by v.platform_code
)
select jsonb_build_object(
  'total',(select count(*) from items),
  'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.batch_id desc) from page p),'[]'::jsonb),
  'coverage',coalesce((select jsonb_agg(to_jsonb(c) order by c.platform_code) from cover c),'[]'::jsonb)
);
$function$;
revoke all on function public.commerce_sales_import_history_v1(text,integer,integer) from public,anon,authenticated;
grant execute on function public.commerce_sales_import_history_v1(text,integer,integer) to service_role;
