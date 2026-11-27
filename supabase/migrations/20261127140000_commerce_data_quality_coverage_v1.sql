-- GA-P02D — commerce_data_quality_coverage_v1 (PREPARADA; NÃO aplicada em produção; aplicação só com aprovação do Atlas).
-- Só a COBERTURA DIÁRIA DE VENDAS de commerce_data_quality_v1 (mesmas validações, mesmas mensagens de recusa, mesmo SQL de cobertura), sem a conciliação
-- GA-011 (commerce_shopee_reconciliation_v1, que estoura 8 s em janelas longas), sem pedidos mensais, relatórios, catálogo e preço.
-- Devolve platform, period e os campos de cobertura de sales (requested_days, complete_days, partial_days, days_with_records_unverified,
-- days_without_information, missing_ranges, status, note): tudo o que coverageProven/gapInfo/stateOf leem. Critérios de cobertura NÃO mudam.
-- Segurança: SECURITY INVOKER, search_path fixo em public, execução só para service_role.
-- NÃO altera commerce_data_quality_v1, commerce_shopee_reconciliation_v1 nem commerce_cached_read_v1; leitura direta, sem cache.
-- Reversão: supabase/rollback/20261127140000_commerce_data_quality_coverage_v1.down.sql (drop function).
create or replace function public.commerce_data_quality_coverage_v1(p_platform text, p_start date default null, p_end date default null)
returns jsonb language plpgsql stable security invoker set search_path = public
as $fn$
declare
  v_plat text := upper(coalesce(p_platform, ''));
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_end date;
  v_start date;
  v_sales jsonb;
begin
  if v_plat not in ('SHOPEE', 'ML_ANTIGO', 'ML_NOVO') then
    raise exception 'plataforma invalida: use SHOPEE, ML_ANTIGO ou ML_NOVO';
  end if;
  v_end := least(coalesce(p_end, v_today), v_today);
  v_start := coalesce(p_start, v_end - 29);
  if v_start > v_end then raise exception 'periodo invalido'; end if;
  if v_end - v_start > 1100 then raise exception 'periodo maior que 1100 dias'; end if;

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

  return jsonb_build_object('platform', v_plat, 'period', jsonb_build_object('start', v_start, 'end', v_end, 'today', v_today), 'sales', v_sales);
end
$fn$;

revoke all on function public.commerce_data_quality_coverage_v1(text, date, date) from public, anon, authenticated;
grant execute on function public.commerce_data_quality_coverage_v1(text, date, date) to service_role;
