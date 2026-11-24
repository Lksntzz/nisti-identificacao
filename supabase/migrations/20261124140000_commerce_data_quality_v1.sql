-- GA-018 — Central de Qualidade dos Dados. SOMENTE LEITURA: nenhuma tabela nova, nenhuma escrita.
-- Reaproveita GA-011 (commerce_shopee_reconciliation_v1) e GA-019 (commerce_sales_reconcile_v2,
-- commerce_sales_month_orders_v2, commerce_sales_day_coverage_v2). Não duplica regra de negócio.
-- Três dimensões separadas por fonte: ATUALIZAÇÃO (data do último dado), COBERTURA (dias/períodos) e CONCILIAÇÃO
-- (consistência INTERNA entre fontes importadas; NÃO prova que o número bate com o marketplace).
-- Informação ausente nunca vira zero: vira 'SEM_INFORMACAO' ou null.
-- Limites de atualização (decisão do dono, 24/11/2026): vendas > 1 dia; Ads, desempenho, tráfego e pós-venda > 30 dias; catálogo > 7 dias.
create or replace function public.commerce_data_quality_v1(
  p_platform text, p_start date default null, p_end date default null, p_detail boolean default false
) returns jsonb
language plpgsql stable security invoker set search_path = public
as $fn$
declare
  v_plat text := upper(coalesce(p_platform, ''));
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_end date;
  v_start date;
  v_acct text;
  v_mk text;
  v_sales jsonb;
  v_reports jsonb;
  v_catalog jsonb;
  v_price jsonb;
  v_open jsonb;
  v_ga011 jsonb := null;
  v_mllink jsonb := null;
  v_orders jsonb;
  v_rec jsonb;
  v_last date;
  v_last_at timestamptz;
begin
  if v_plat not in ('SHOPEE', 'ML_ANTIGO', 'ML_NOVO') then
    raise exception 'plataforma invalida: use SHOPEE, ML_ANTIGO ou ML_NOVO';
  end if;
  v_end := least(coalesce(p_end, v_today), v_today);
  v_start := coalesce(p_start, v_end - 29);
  if v_start > v_end then raise exception 'periodo invalido'; end if;
  if v_end - v_start > 1100 then raise exception 'periodo maior que 1100 dias'; end if;
  v_mk := case when v_plat = 'SHOPEE' then 'SHOPEE' else 'MERCADO_LIVRE' end;
  v_acct := case v_plat when 'ML_ANTIGO' then 'ANTIGO' when 'ML_NOVO' then 'NOVO' else null end;

  -- ===== VENDAS: atualização =====
  -- fonte diária da GA-019 (independe de vínculo com anúncio/SKU, então não esconde dias da Shopee)
  select max(x.sale_date) into v_last from public.commerce_sales_daily_source_v2(v_plat, date '1900-01-01', v_today) x;
  select max(b.committed_at) into v_last_at from public.commerce_sales_import_batches b
    where b.platform_code = v_plat and b.status = 'COMMITTED';

  -- ===== VENDAS: cobertura diária (completo / parcial / com registros / sem informação) =====
  with days as (select d::date sale_date from generate_series(v_start, v_end, interval '1 day') d),
  have as (
    select distinct x.sale_date from public.commerce_sales_daily_source_v2(v_plat, v_start, v_end) x
  ),
  cov as (
    select distinct on (c.sale_date) c.sale_date, c.is_final
    from public.commerce_sales_day_coverage_v2 c
    where c.platform_code = v_plat and c.applied and c.sale_date between v_start and v_end
    order by c.sale_date, c.batch_id desc
  ),
  cls as (
    select d.sale_date,
      case
        when cov.sale_date is not null and not cov.is_final then 'PARCIAL'
        when d.sale_date >= v_today and (cov.sale_date is not null or h.sale_date is not null) then 'PARCIAL'
        when cov.sale_date is not null then 'COMPLETO'
        when h.sale_date is not null then 'COM_REGISTROS'
        else 'SEM_INFORMACAO' end st
    from days d left join have h using (sale_date) left join cov using (sale_date)
  ),
  gaps as (
    select min(sale_date) a, max(sale_date) b, count(*) n from (
      select sale_date, sale_date - (row_number() over (order by sale_date))::int g from cls where st = 'SEM_INFORMACAO') q
    group by g
  ),
  tot as (
    select count(*) filter (where st = 'COMPLETO') complete, count(*) filter (where st = 'PARCIAL') partial,
           count(*) filter (where st = 'COM_REGISTROS') records, count(*) filter (where st = 'SEM_INFORMACAO') none,
           count(*) requested from cls
  )
  select jsonb_build_object(
    'requested_days', t.requested, 'complete_days', t.complete, 'partial_days', t.partial,
    'days_with_records_unverified', t.records, 'days_without_information', t.none,
    'missing_ranges', coalesce((select jsonb_agg(jsonb_build_object('start', g.a, 'end', g.b, 'days', g.n) order by g.a)
                                from (select * from gaps order by a limit 50) g), '[]'::jsonb),
    'status', case when t.requested = 0 then 'SEM_INFORMACAO'
                   when t.none = t.requested then 'SEM_INFORMACAO'
                   when t.none > 0 or t.partial > 0 or t.records > 0 then 'PARCIAL'
                   else 'COMPLETA' end,
    'note', 'Venda em todos os dias não prova que todos os pedidos foram importados. Dia sem registros é dado ausente, nunca venda zero.')
  into v_sales from tot t;

  -- ===== VENDAS: conciliação interna (GA-019) =====
  select jsonb_build_object(
    'months_checked', count(*), 'months_ok', count(*) filter (where r.ok),
    'divergent_months', coalesce(jsonb_agg(jsonb_build_object('month', r.month_start,
        'summary_units', r.summary_units, 'rows_units', r.rows_units, 'daily_units', r.daily_units,
        'summary_revenue', r.summary_revenue, 'rows_revenue', r.rows_revenue, 'daily_revenue', r.daily_revenue)
        order by r.month_start) filter (where not r.ok), '[]'::jsonb),
    'status', case when count(*) = 0 then 'SEM_INFORMACAO' when bool_and(r.ok) then 'CONCILIADO_INTERNAMENTE' else 'DIVERGENTE' end,
    'scope', 'consistência interna entre resumo, linhas e vendas diárias importadas; não conferido no marketplace')
  into v_rec
  from public.commerce_sales_reconcile_v2(v_plat) r
  where r.month_start between date_trunc('month', v_start)::date and v_end;

  -- ===== VENDAS: pedidos únicos (GA-019), até 12 meses (INTEIROS) mais recentes do período =====
  -- A regra de contagem é da GA-019 e não é alterada: pedido contado POR DIA (pedido em dois dias conta 2).
  -- Aqui só se separa a BASE: por chave (dia da v2), resumo histórico (dia legado), misto, parcial ou sem informação.
  select coalesce(jsonb_agg(jsonb_build_object('month', m.mo,
      'orders', case when m.k + m.h = 0 then null else (m.res ->> 'orders')::bigint end,
      'basis', case when m.k + m.h = 0 then 'SEM_INFORMACAO' when m.h = 0 then 'CHAVE' when m.k = 0 then 'RESUMO_HISTORICO' else 'MISTO' end,
      'verified_by_key', (m.k + m.h > 0 and m.h = 0 and (m.res ->> 'orders') is not null),
      'days_by_key', m.k, 'days_by_summary', m.h, 'days_expected', m.expected,
      'coverage', case when m.k + m.h = 0 then 'SEM_INFORMACAO' when m.k + m.h < m.expected then 'PARCIAL' else 'COMPLETA' end,
      'unresolved', m.res -> 'unresolved',
      'reported_in_summary', m.reported) order by m.mo desc), '[]'::jsonb)
  into v_orders
  from (
    select x.mo, r.res, d.k, d.h, (least((x.mo + interval '1 month - 1 day')::date, v_today) - x.mo + 1) as expected,
      (select sum(s.net_orders) from public.commerce_sales_summary_rows s
        where s.snapshot_id = (select id from public.commerce_sales_snapshots where is_current order by id desc limit 1)
          and s.platform_code = v_plat and date_trunc('month', s.period_start)::date = x.mo) as reported
    from (select distinct date_trunc('month', g)::date mo from generate_series(v_start, v_end, interval '1 day') g
          order by 1 desc limit 12) x
    cross join lateral (select public.commerce_sales_month_orders_v2(v_plat, x.mo) res) r
    cross join lateral (select count(*) filter (where w.kind = 'V2') k, count(*) filter (where w.kind <> 'V2') h
      from public.commerce_sales_day_winners_v2(v_plat, x.mo, least((x.mo + interval '1 month - 1 day')::date, v_today)) w) d
  ) m;

  v_sales := v_sales || jsonb_build_object(
    'last_sale_day', v_last, 'last_import_at', v_last_at, 'days_behind', case when v_last is null then null else v_today - v_last end,
    'freshness', case when v_last is null then 'SEM_INFORMACAO' when v_today - v_last > 1 then 'DESATUALIZADO' else 'ATUALIZADO' end,
    'threshold_days', 1, 'reconciliation', v_rec, 'orders', v_orders,
    'orders_note', 'Contagem POR DIA (regra da GA-019): pedido que aparece em dois dias conta duas vezes. Só a base CHAVE é verificada por chave; RESUMO_HISTORICO é o número informado no arquivo antigo.',
    'months_scope_note', 'Conciliação e pedidos mensais usam MESES INTEIROS, mesmo quando o período filtrado cobre só parte do mês.');

  -- ===== SHOPEE: GA-011 (SKU da fonte x anúncios da base) =====
  if v_plat = 'SHOPEE' then
    declare r jsonb; d jsonb; rec text; begin
      r := public.commerce_shopee_reconciliation_v1(v_start, v_end, case when p_detail then 200 else 10 end);
      d := r -> 'difference';
      -- COMPLETO = cobertura de registros, não ausência de divergência: a conciliação exige diferença explicada e resíduo zero.
      rec := case when d is null or (d ->> 'residual_units') is null or (d ->> 'residual_revenue') is null then 'SEM_INFORMACAO'
        when coalesce((d ->> 'explained')::boolean, false) and (d ->> 'residual_units')::numeric = 0
          and abs((d ->> 'residual_revenue')::numeric) < 0.005 then 'CONCILIADO_INTERNAMENTE'
        else 'DIVERGENTE' end;
      v_ga011 := jsonb_build_object('coverage_status', r -> 'status', 'reconciliation_status', rec,
        'reconciled_pct', r -> 'reconciled_pct', 'difference', d,
        'explained', d -> 'explained', 'residual_units', d -> 'residual_units', 'residual_revenue', d -> 'residual_revenue',
        'coverage', r -> 'coverage',
        'unmatched_sku_count', jsonb_array_length(coalesce(r -> 'unmatched_skus', '[]'::jsonb)),
        'unmatched_skus', case when p_detail then r -> 'unmatched_skus' else null end);
    end;
  else
    -- ===== ML: vendas sem anúncio cadastrado — INFORMATIVO; continuam nos totais; não presume anúncio inativo =====
    with s as (
      select v.external_listing_id, sum(v.units) units, sum(v.product_revenue) rev
      from public.commerce_current_sales_listing_daily_v1 v
      where v.platform_code = v_plat and v.sale_date between v_start and v_end group by 1),
    f as (
      select s.*, exists (select 1 from public.commerce_listings l join public.commerce_marketplaces m on m.id = l.marketplace_id
        where m.code = 'MERCADO_LIVRE' and l.account_code = v_acct and l.external_listing_id = s.external_listing_id) linked from s)
    select case when count(*) = 0 then jsonb_build_object('severity', 'SEM_INFORMACAO', 'status', 'SEM_INFORMACAO',
      'note', 'Nenhuma venda registrada neste período: não há totais a mostrar (e isso não significa venda zero).')
    else jsonb_build_object(
      'severity', 'INFORMATIVO',
      'listings_with_sales', count(*), 'listings_without_registered_listing', count(*) filter (where not linked),
      'units_without_registered_listing', coalesce(sum(units) filter (where not linked), 0),
      'revenue_without_registered_listing', round(coalesce(sum(rev) filter (where not linked), 0), 2),
      'total_units', coalesce(sum(units), 0), 'total_revenue', round(coalesce(sum(rev), 0), 2),
      'pct_revenue', case when sum(rev) > 0 then round(100 * coalesce(sum(rev) filter (where not linked), 0) / sum(rev), 2) else null end,
      'pct_units', case when sum(units) > 0 then round(100 * coalesce(sum(units) filter (where not linked), 0)::numeric / sum(units), 2) else null end,
      'items', case when p_detail then (select coalesce(jsonb_agg(jsonb_build_object('external_listing_id', x.external_listing_id,
          'units', x.units, 'revenue', round(x.rev, 2)) order by x.rev desc), '[]'::jsonb)
          from (select * from f where not linked order by rev desc limit 200) x) else null end,
      'note', 'Essas vendas estão incluídas nos totais. O catálogo do GA pode não conter todos os anúncios da conta; não se presume que o anúncio esteja inativo.') end
    into v_mllink from f;
  end if;

  -- ===== RELATÓRIOS: atualização e PERÍODO informado (nunca prova de cobertura diária) =====
  with rep as (
    select 'DESEMPENHO' kind, r.id, r.period_start ps, r.period_end pe, r.imported_at at from public.commerce_shopee_performance_reports_v1 r where v_plat = 'SHOPEE'
    union all select 'ADS', r.id, r.period_start, r.period_end, r.inserted_at from public.commerce_shopee_ads_reports_v1 r where v_plat = 'SHOPEE'
    union all select 'POS_VENDA', r.id, r.period_start, r.period_end, r.imported_at from public.commerce_shopee_aftercare_reports_v1 r where v_plat = 'SHOPEE'
    union all select 'DESEMPENHO', r.id, r.period_start, r.period_end, r.imported_at from public.commerce_ml_performance_reports_v1 r where v_plat <> 'SHOPEE' and r.account_code = v_acct
    union all select 'TRAFEGO_MANUAL', t.id, t.period_start, t.period_end, t.recorded_at
      from public.commerce_listing_traffic_reports_v1 t join public.commerce_listings l on l.id = t.listing_id
      join public.commerce_marketplaces m on m.id = l.marketplace_id
      where m.code = v_mk and (v_acct is null or l.account_code = v_acct)
  ),
  kinds as (select * from (values ('DESEMPENHO'), ('ADS'), ('POS_VENDA'), ('TRAFEGO_MANUAL')) k(kind)),
  agg as (
    select k.kind, count(r.id) n, min(r.ps) first_start, max(r.pe) last_end, max(r.at) last_imported_at,
      bool_or(r.ps <= v_end and r.pe >= v_start) overlaps_requested_period,
      (select count(*) from rep a join rep b on a.kind = b.kind and a.id < b.id and a.ps <= b.pe and b.ps <= a.pe where a.kind = k.kind) overlapping_pairs
    from kinds k left join rep r on r.kind = k.kind group by k.kind
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', a.kind, 'reports', a.n, 'first_period_start', a.first_start, 'last_period_end', a.last_end,
    'last_imported_at', a.last_imported_at, 'days_since_period_end', case when a.last_end is null then null else v_today - a.last_end end,
    'threshold_days', 30,
    'freshness', case when a.n = 0 then 'SEM_INFORMACAO' when v_today - a.last_end > 30 then 'DESATUALIZADO' else 'ATUALIZADO' end,
    'period_overlaps_requested', case when a.n = 0 then null else coalesce(a.overlaps_requested_period, false) end,
    'overlapping_report_pairs', a.overlapping_pairs,
    'daily_coverage_proven', false,
    'note', 'Período do relatório não é cobertura diária comprovada.') order by a.kind), '[]'::jsonb)
  into v_reports from agg a;
  -- ADS do Mercado Livre: não existe fonte importada.
  if v_plat <> 'SHOPEE' then
    v_reports := v_reports || jsonb_build_array(jsonb_build_object('kind', 'ADS_ML', 'reports', 0, 'freshness', 'SEM_INFORMACAO',
      'note', 'Não existe fonte de Ads do Mercado Livre importada.'));
  end if;

  -- ===== CATÁLOGO: situação ANÚNCIO A ANÚNCIO (> 7 dias sem verificação = desatualizado); a data mais recente não prova o todo =====
  with c as (
    select l.last_checked_at,
      (l.last_checked_at is not null and v_today - (l.last_checked_at at time zone 'America/Sao_Paulo')::date <= 7) fresh
    from public.commerce_listings l join public.commerce_marketplaces m on m.id = l.marketplace_id
    where m.code = v_mk and (v_acct is null or l.account_code = v_acct)
  )
  select jsonb_build_object('listings', count(*), 'last_checked_at', max(last_checked_at), 'oldest_checked_at', min(last_checked_at),
    'fresh_listings', count(*) filter (where fresh),
    'stale_listings', count(*) filter (where last_checked_at is not null and not fresh),
    'never_checked_listings', count(*) filter (where last_checked_at is null),
    'not_fresh_listings', count(*) filter (where not fresh),
    'not_fresh_pct', case when count(*) = 0 then null else round(100 * count(*) filter (where not fresh)::numeric / count(*), 2) end,
    'days_since_last_check', case when max(last_checked_at) is null then null else v_today - (max(last_checked_at) at time zone 'America/Sao_Paulo')::date end,
    'days_since_oldest_check', case when min(last_checked_at) is null then null else v_today - (min(last_checked_at) at time zone 'America/Sao_Paulo')::date end,
    'threshold_days', 7,
    'freshness', case when count(*) = 0 or count(last_checked_at) = 0 then 'SEM_INFORMACAO'
      when count(*) filter (where fresh) = count(*) then 'ATUALIZADO'
      when count(*) filter (where fresh) = 0 then 'DESATUALIZADO'
      else 'PARCIALMENTE_DESATUALIZADO' end,
    'note', 'Situação por anúncio. O catálogo do GA pode não conter todos os anúncios da conta e não garante que todos sejam ativos.')
  into v_catalog from c;

  -- ===== PREÇO E ESTOQUE: preço cadastrado, preço realizado e estoque declarado na foto do catálogo, separados =====
  with v as (
    select l.last_checked_at, x.value var
    from public.commerce_listings l join public.commerce_marketplaces m on m.id = l.marketplace_id,
      lateral jsonb_array_elements(case when jsonb_typeof(l.raw_metadata -> 'shopee_sales_info' -> 'variations') = 'array'
        then l.raw_metadata -> 'shopee_sales_info' -> 'variations' else '[]'::jsonb end) x
    where v_plat = 'SHOPEE' and m.code = 'SHOPEE'
  ),
  vv as (
    select (var ->> 'price') ~ '^[0-9]+([.,][0-9]+)?$' and replace(var ->> 'price', ',', '.')::numeric > 0 as price_ok,
           (var ->> 'stock') ~ '^[0-9]+$' as stock_ok, var ->> 'stock' as stock_v, last_checked_at from v
  ),
  top_stock as (select stock_v, count(*) n from vv where stock_ok group by 1 order by 2 desc, 1 limit 1),
  agg as (select count(*) vt, count(*) filter (where price_ok) vp, count(*) filter (where stock_ok) vs, max(last_checked_at) snap from vv),
  real as (
    select count(*) listings_with_sales_rows, count(*) filter (where u > 0) with_units from (
      select v.external_listing_id, sum(v.units) u from public.commerce_current_sales_listing_daily_v1 v
      where v.platform_code = v_plat and v.sale_date between v_start and v_end group by 1) q
  )
  select jsonb_build_object(
    'registered_price', jsonb_build_object('source', case when v_plat = 'SHOPEE' then 'FOTO_DO_CATALOGO' else null end,
      'status', case when a.vt = 0 then 'SEM_INFORMACAO' when a.vp = 0 then 'SEM_VALOR_VALIDO' when a.vp < a.vt then 'PARCIAL' else 'DISPONIVEL_FOTO' end,
      'variations', a.vt, 'variations_with_price', a.vp, 'variations_without_valid_price', a.vt - a.vp,
      'snapshot_last_checked_at', a.snap,
      'note', 'Foto do catálogo sem data própria do preço; preço do ML não é importado nesta versão.'),
    'realized_price', jsonb_build_object('source', 'VENDAS_IMPORTADAS',
      'status', case when (select with_units from real) > 0 then 'DISPONIVEL' else 'SEM_INFORMACAO' end,
      'listings_with_units', case when (select listings_with_sales_rows from real) = 0 then null else (select with_units from real) end,
      'note', 'Receita ÷ unidades do período; não é o preço de tabela.'),
    'stock', jsonb_build_object('source', case when v_plat = 'SHOPEE' then 'FOTO_DO_CATALOGO' else null end,
      'status', case when a.vt = 0 then 'SEM_INFORMACAO' when a.vs = 0 then 'SEM_VALOR_VALIDO' when a.vs < a.vt then 'PARCIAL' else 'DISPONIVEL_FOTO' end,
      'variations', a.vt, 'variations_with_stock', a.vs, 'variations_without_valid_stock', a.vt - a.vs,
      'most_common_value', (select stock_v from top_stock),
      'most_common_share_pct', case when a.vs = 0 then null else round(100 * (select n from top_stock)::numeric / a.vs, 2) end,
      'possibly_nominal', coalesce((select n from top_stock)::numeric / nullif(a.vs, 0) >= 0.5 and a.vs >= 10, false),
      'snapshot_last_checked_at', a.snap, 'real_time', false, 'is_real_stock', false,
      'note', 'Valor declarado na foto do catálogo: não é estoque real nem em tempo real; valor repetido em muitas variações indica estoque nominal.'))
  into v_price from agg a;

  -- ===== LOTES ABERTOS (lidos e nunca aplicados) =====
  select coalesce(jsonb_agg(jsonb_build_object('batch_id', b.id, 'file', b.source_filename, 'status', b.status,
    'created_at', b.created_at, 'data_through', b.data_through, 'rows', b.staged_row_count) order by b.id), '[]'::jsonb)
  into v_open from public.commerce_sales_import_batches b where b.platform_code = v_plat and b.status <> 'COMMITTED';

  return jsonb_build_object(
    'platform', v_plat, 'period', jsonb_build_object('start', v_start, 'end', v_end, 'today', v_today),
    'generated_at', now(),
    'thresholds_days', jsonb_build_object('sales', 1, 'reports', 30, 'catalog', 7),
    'sales', v_sales, 'ga011_shopee', v_ga011, 'ml_unlinked_sales', v_mllink,
    'reports', v_reports, 'catalog', v_catalog, 'price_stock', v_price, 'open_batches', v_open,
    'disclaimer', 'Conciliação é consistência interna dos arquivos importados; não prova exatidão perante o marketplace.');
end
$fn$;
revoke all on function public.commerce_data_quality_v1(text, date, date, boolean) from public, anon, authenticated;
grant execute on function public.commerce_data_quality_v1(text, date, date, boolean) to service_role;
