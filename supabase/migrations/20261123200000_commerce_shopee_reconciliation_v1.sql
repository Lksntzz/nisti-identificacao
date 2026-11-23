-- GA-011 (somente leitura): conciliacao das vendas da Shopee por periodo.
-- Compara a FONTE (vendas por SKU importadas do relatorio de pedidos) com a BASE (vendas por anuncio que o GA usa,
-- view commerce_current_sales_listing_daily_v1) e mostra onde a venda se perde: SKU sem vinculo a anuncio.
-- Regras:
--  * Fonte por SKU = mesma regra da view: lotes COMMITTED, snapshot mais recente de cada dia, receita arredondada em 2 casas.
--  * Vinculo SKU -> anuncio = commerce_shopee_sku_owner_reviewed_v1 (inclui SKU antigo ligado ao atual: source_sku_norm -> canonical_sku_norm).
--  * Venda sem vinculo NUNCA e descartada: aparece completa em unmatched_skus (sem corte) e entra no total da fonte.
--  * Dia sem nenhuma linha importada = dado ausente (coverage.missing_ranges), nunca zero confirmado.
--    Sem nenhum dado no periodo: status SEM_DADOS e totais nulos.
--  * Dia em que a base usa linhas nativas por anuncio (hoje nenhum na Shopee) e tratado a parte (native_days_effect).
--  * residual = diferenca que NAO se explica por SKU sem vinculo nem por dia nativo; deve ser 0. Se nao for, ha divergencia a investigar.
-- Nao altera view, curva ABC, importadores nem registros. Funcao nova, versionada, so service_role executa.
create or replace function public.commerce_shopee_reconciliation_v1(
  p_start date,
  p_end date,
  p_limit integer default 500
) returns jsonb language plpgsql stable security invoker set search_path=public
as $fn$
declare r jsonb; lim integer;
begin
 if p_start is null or p_end is null then raise exception 'Informe o período (início e fim).'; end if;
 if p_start > p_end then raise exception 'Período inválido: o início é depois do fim.'; end if;
 if p_end - p_start > 1100 then raise exception 'Período longo demais (máximo de 1100 dias).'; end if;
 lim := greatest(1, least(coalesce(p_limit, 500), 2000));

 with
 days as (
   select g::date as d from generate_series(p_start::timestamp, p_end::timestamp, interval '1 day') g
 ),
 sku_source as (
   select d.sale_date, d.sku_norm, d.units, d.product_revenue, coalesce(b.snapshot_id, 0::bigint) as snap
   from public.commerce_shopee_sales_sku_daily_v1 d
   join public.commerce_sales_import_batches b on b.id = d.batch_id
   where b.platform_code = 'SHOPEE' and b.status = 'COMMITTED' and d.sale_date between p_start and p_end
 ),
 most_recent as (
   select sale_date, max(snap) as snap from sku_source group by sale_date
 ),
 cur as (
   select s.sale_date, s.sku_norm,
     sum(s.units)::integer as units,
     round(sum(s.product_revenue), 2)::numeric(14,2) as revenue
   from sku_source s
   join most_recent v on v.sale_date = s.sale_date and v.snap = s.snap
   group by s.sale_date, s.sku_norm
 ),
 native_days as (
   select distinct d.sale_date
   from public.commerce_sales_import_batches b
   join public.commerce_sales_import_stage_summary s on s.batch_id = b.id and s.period_start = s.period_end
   join public.commerce_sales_listing_daily_v1 d on d.batch_id = b.id and d.sale_date = s.period_start
   where b.status = 'COMMITTED' and b.platform_code = 'SHOPEE' and d.sale_date between p_start and p_end
 ),
 owner as (
   select source_sku_norm, canonical_sku_norm, external_listing_id, mapping_type
   from public.commerce_shopee_sku_owner_reviewed_v1
 ),
 cls as materialized (
   select c.sale_date, c.sku_norm, c.units, c.revenue,
     (o.source_sku_norm is not null) as has_owner,
     (nd.sale_date is not null) as native_day,
     o.canonical_sku_norm, o.external_listing_id as owner_ext, o.mapping_type
   from cur c
   left join owner o on o.source_sku_norm = c.sku_norm
   left join native_days nd on nd.sale_date = c.sale_date
 ),
 base as materialized (
   select v.sale_date, v.external_listing_id as ext, v.units, v.product_revenue
   from public.commerce_current_sales_listing_daily_v1 v
   where v.platform_code = 'SHOPEE' and v.sale_date between p_start and p_end
 ),
 agg as (
   select count(*) as n_rows, count(distinct sale_date) as src_days, count(distinct sku_norm) as n_skus,
     coalesce(sum(units), 0) as su, coalesce(sum(revenue), 0) as sr,
     coalesce(sum(units) filter (where has_owner), 0) as mu, coalesce(sum(revenue) filter (where has_owner), 0) as mr,
     coalesce(sum(units) filter (where not has_owner), 0) as uu, coalesce(sum(revenue) filter (where not has_owner), 0) as ur,
     coalesce(sum(units) filter (where has_owner and not native_day), 0) as nmu,
     coalesce(sum(revenue) filter (where has_owner and not native_day), 0) as nmr,
     coalesce(sum(units) filter (where not has_owner and not native_day), 0) as nuu,
     coalesce(sum(revenue) filter (where not has_owner and not native_day), 0) as nur,
     coalesce(sum(units) filter (where native_day), 0) as natu,
     coalesce(sum(revenue) filter (where native_day), 0) as natr
   from cls
 ),
 bagg as (
   select count(*) as n_rows, count(distinct sale_date) as base_days, count(distinct ext) as n_listings,
     coalesce(sum(units), 0) as bu, coalesce(sum(product_revenue), 0) as br,
     coalesce(sum(units) filter (where sale_date in (select sale_date from native_days)), 0) as bnu,
     coalesce(sum(product_revenue) filter (where sale_date in (select sale_date from native_days)), 0) as bnr
   from base
 ),
 sku_agg as (
   select c.sku_norm, sum(c.units)::bigint as units, round(sum(c.revenue), 2) as revenue,
     count(distinct c.sale_date) as days_with_sales, min(c.sale_date) as first_day, max(c.sale_date) as last_day,
     bool_or(c.has_owner) as matched, max(c.canonical_sku_norm) as canonical_sku, max(c.owner_ext) as listing_ext,
     max(c.mapping_type) as mapping_type,
     (select h.review_reason from public.commerce_shopee_sales_history_reviews_v1 h
       where h.source_sku_norm = c.sku_norm and h.active limit 1) as history_review
   from cls c group by c.sku_norm
 ),
 lst_base as (
   select ext, sum(units)::bigint as u, round(sum(product_revenue), 2) as rv, count(distinct sale_date) as days from base group by ext
 ),
 lst_src as (
   select owner_ext as ext, sum(units)::bigint as u, round(sum(revenue), 2) as rv
   from cls where has_owner and not native_day group by owner_ext
 ),
 lst as (
   select coalesce(b.ext, s.ext) as ext, b.u as base_units, b.rv as base_revenue, b.days as base_days,
     s.u as source_units, s.rv as source_revenue,
     coalesce(b.u, 0) - coalesce(s.u, 0) as diff_units,
     round(coalesce(b.rv, 0) - coalesce(s.rv, 0), 2) as diff_revenue,
     (select l.title from public.commerce_listings l join public.commerce_marketplaces m on m.id = l.marketplace_id
       where m.code = 'SHOPEE' and l.external_listing_id = coalesce(b.ext, s.ext) limit 1) as title,
     (select l.listing_status from public.commerce_listings l join public.commerce_marketplaces m on m.id = l.marketplace_id
       where m.code = 'SHOPEE' and l.external_listing_id = coalesce(b.ext, s.ext) limit 1) as listing_status
   from lst_base b full join lst_src s on s.ext = b.ext
 ),
 src_dates as materialized (
   select distinct sale_date from cur
 ),
 base_dates as materialized (
   select distinct sale_date from base
 ),
 miss as (
   select d.d from days d where d.d not in (select sale_date from src_dates)
 ),
 miss_isl as (
   select d, d - (row_number() over (order by d))::integer as grp from miss
 ),
 miss_rng as (
   select min(d) as a, max(d) as b, count(*) as n from miss_isl group by grp
 )
 select jsonb_build_object(
   'period', jsonb_build_object('start', p_start, 'end', p_end, 'days', p_end - p_start + 1),
   'status', case when (select n_rows from agg) = 0 then 'SEM_DADOS'
                  when exists (select 1 from miss) then 'PARCIAL' else 'COMPLETO' end,
   'totals', jsonb_build_object(
     'source', jsonb_build_object(
       'units', case when (select n_rows from agg) = 0 then null else (select su from agg) end,
       'revenue', case when (select n_rows from agg) = 0 then null else (select sr from agg) end,
       'skus', case when (select n_rows from agg) = 0 then null else (select n_skus from agg) end),
     'base', jsonb_build_object(
       'units', case when (select n_rows from bagg) = 0 then null else (select bu from bagg) end,
       'revenue', case when (select n_rows from bagg) = 0 then null else (select br from bagg) end,
       'listings', case when (select n_rows from bagg) = 0 then null else (select n_listings from bagg) end)),
   'difference', case when (select n_rows from agg) = 0 then null else jsonb_build_object(
     'units', (select bu - su from bagg, agg),
     'revenue', (select br - sr from bagg, agg),
     'unmatched_effect_units', (select -nuu from agg),
     'unmatched_effect_revenue', (select -nur from agg),
     'native_days_effect_units', (select bnu - natu from bagg, agg),
     'native_days_effect_revenue', (select bnr - natr from bagg, agg),
     'residual_units', (select bu - (nmu + bnu) from bagg, agg),
     'residual_revenue', (select round(br - (nmr + bnr), 2) from bagg, agg),
     'explained', (select abs(bu - (nmu + bnu)) = 0 and abs(br - (nmr + bnr)) < 0.005 from bagg, agg)) end,
   'reconciled_pct', jsonb_build_object(
     'revenue', (select round(100 * mr / nullif(sr, 0), 2) from agg),
     'units', (select round(100 * mu::numeric / nullif(su, 0), 2) from agg),
     'matched_revenue', case when (select n_rows from agg) = 0 then null else (select mr from agg) end,
     'unmatched_revenue', case when (select n_rows from agg) = 0 then null else (select ur from agg) end,
     'matched_units', case when (select n_rows from agg) = 0 then null else (select mu from agg) end,
     'unmatched_units', case when (select n_rows from agg) = 0 then null else (select uu from agg) end),
   'unmatched_skus', (select coalesce(jsonb_agg(jsonb_build_object(
       'sku_norm', s.sku_norm, 'units', s.units, 'revenue', s.revenue,
       'days_with_sales', s.days_with_sales, 'first_day', s.first_day, 'last_day', s.last_day,
       'history_review', s.history_review) order by s.revenue desc, s.sku_norm), '[]'::jsonb)
     from sku_agg s where not s.matched),
   'skus', jsonb_build_object(
     'total', (select count(*) from sku_agg),
     'truncated', (select count(*) from sku_agg) > lim,
     'items', (select coalesce(jsonb_agg(jsonb_build_object(
         'sku_norm', t.sku_norm, 'units', t.units, 'revenue', t.revenue, 'days_with_sales', t.days_with_sales,
         'matched', t.matched, 'canonical_sku', t.canonical_sku, 'listing_id', t.listing_ext,
         'mapping_type', t.mapping_type,
         'old_sku_linked_to_current', (t.matched and t.canonical_sku is distinct from t.sku_norm))
         order by t.revenue desc, t.sku_norm), '[]'::jsonb)
       from (select * from sku_agg order by revenue desc, sku_norm limit lim) t)),
   'listings', jsonb_build_object(
     'total', (select count(*) from lst),
     'truncated', (select count(*) from lst) > lim,
     'items', (select coalesce(jsonb_agg(jsonb_build_object(
         'listing_id', t.ext, 'title', t.title, 'listing_status', t.listing_status,
         'base_units', t.base_units, 'base_revenue', t.base_revenue,
         'source_units', t.source_units, 'source_revenue', t.source_revenue,
         'diff_units', t.diff_units, 'diff_revenue', t.diff_revenue)
         order by t.base_revenue desc nulls last, t.ext), '[]'::jsonb)
       from (select * from lst order by base_revenue desc nulls last, ext limit lim) t)),
   'listings_with_difference', (select coalesce(jsonb_agg(jsonb_build_object(
       'listing_id', t.ext, 'title', t.title, 'base_units', t.base_units, 'base_revenue', t.base_revenue,
       'source_units', t.source_units, 'source_revenue', t.source_revenue,
       'diff_units', t.diff_units, 'diff_revenue', t.diff_revenue) order by abs(t.diff_revenue) desc, t.ext), '[]'::jsonb)
     from lst t where t.diff_units <> 0 or abs(t.diff_revenue) >= 0.005),
   'coverage', jsonb_build_object(
     'requested_days', p_end - p_start + 1,
     'source_days_with_data', (select src_days from agg),
     'source_first_day', (select min(sale_date) from cur),
     'source_last_day', (select max(sale_date) from cur),
     'source_missing_days', (select count(*) from miss),
     'missing_ranges', (select coalesce(jsonb_agg(jsonb_build_object('start', m.a, 'end', m.b, 'days', m.n) order by m.a), '[]'::jsonb)
       from (select * from miss_rng order by a limit 50) m),
     'base_days_with_data', (select base_days from bagg),
     'source_days_absent_from_base', (select count(*) from src_dates sd where sd.sale_date not in (select sale_date from base_dates)),
     'native_days', (select count(*) from native_days),
     'includes_today', ((now() at time zone 'America/Sao_Paulo')::date between p_start and p_end),
     'latest_import_data_through', (select max(b.data_through) from public.commerce_sales_import_batches b where b.platform_code = 'SHOPEE' and b.status = 'COMMITTED'),
     'note', 'Dia sem linhas importadas é dado ausente, não venda zero.')
 ) into r;
 return r;
end
$fn$;
revoke all on function public.commerce_shopee_reconciliation_v1(date, date, integer) from public, anon, authenticated;
grant execute on function public.commerce_shopee_reconciliation_v1(date, date, integer) to service_role;
