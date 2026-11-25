-- GA-014 — Central de decisões comerciais: fonte de leitura por anúncio (SOMENTE UNIDADES).
-- Migração preparada como ARQUIVO. NÃO é aplicada pelo deploy; só será aplicada no Supabase com autorização do dono.
--
-- commerce_decision_units_v1(p_platform, p_cur_start, p_cur_end, p_prev_start, p_prev_end, p_limit)
--   Devolve, para UMA conta (SHOPEE, ML_ANTIGO ou ML_NOVO), as unidades vendidas por anúncio no período atual e no anterior,
--   a última e a primeira venda importadas, o último estado cadastrado (com a data da verificação) e, quando existirem,
--   as métricas de desempenho (visitas, impressões, cliques, pedidos) dos dois relatórios mais recentes SEM sobreposição da MESMA conta.
--
-- O que a função NÃO faz: não calcula faturamento (a coluna de receita da view nem é lida), não classifica, não cobre lacunas de
-- cobertura (isso é da GA-018, consultada pelo Worker), não grava nada, não distribui venda sem vínculo entre anúncios.
-- Identidade do anúncio = conta + ID: a fonte já é filtrada pela conta (platform_code). O mesmo ID em outra conta não entra.
-- Venda de anúncio sem cadastro continua no resultado (registered=false); cadastro repetido para o mesmo conta+ID marca
-- ambiguous_status=true e esconde só título e situação (as unidades NÃO são descartadas).
-- Totais e contagens são calculados sobre TODOS os anúncios, antes de qualquer limite de linhas (p_limit só corta a lista;
-- row_count e truncated dizem se cortou).
create or replace function public.commerce_decision_units_v1(
  p_platform text,
  p_cur_start date,
  p_cur_end date,
  p_prev_start date,
  p_prev_end date,
  p_limit integer default 3000
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_span integer;
  v_acct text;
  v_rb bigint;
  v_ra bigint;
  r jsonb;
begin
  if p_platform is null or p_platform not in ('SHOPEE', 'ML_ANTIGO', 'ML_NOVO') then
    raise exception 'decision_units: plataforma inválida' using errcode = '22023';
  end if;
  if p_cur_start is null or p_cur_end is null or p_prev_start is null or p_prev_end is null then
    raise exception 'decision_units: datas obrigatórias' using errcode = '22023';
  end if;
  if p_cur_end < p_cur_start or p_prev_end < p_prev_start then
    raise exception 'decision_units: início depois do fim' using errcode = '22023';
  end if;
  if p_prev_end >= p_cur_start then
    raise exception 'decision_units: o período anterior deve terminar antes do atual' using errcode = '22023';
  end if;
  v_span := p_cur_end - p_cur_start + 1;
  if v_span <> (p_prev_end - p_prev_start + 1) then
    raise exception 'decision_units: períodos de tamanhos diferentes' using errcode = '22023';
  end if;
  if v_span < 1 or v_span > 93 then
    raise exception 'decision_units: período fora de 1 a 93 dias' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'decision_units: limite fora de 1 a 5000' using errcode = '22023';
  end if;

  v_acct := case p_platform when 'ML_ANTIGO' then 'ANTIGO' when 'ML_NOVO' then 'NOVO' else null end;

  -- Relatórios de desempenho: o mais recente e o mais recente que terminou ANTES do começo dele (sem sobreposição), da mesma conta.
  if p_platform = 'SHOPEE' then
    select id into v_rb from public.commerce_shopee_performance_reports_v1 order by period_end desc, id desc limit 1;
    if v_rb is not null then
      select id into v_ra from public.commerce_shopee_performance_reports_v1
        where period_end < (select period_start from public.commerce_shopee_performance_reports_v1 where id = v_rb)
        order by period_end desc, id desc limit 1;
    end if;
  else
    select id into v_rb from public.commerce_ml_performance_reports_v1 where account_code = v_acct order by period_end desc, id desc limit 1;
    if v_rb is not null then
      select id into v_ra from public.commerce_ml_performance_reports_v1
        where account_code = v_acct
          and period_end < (select period_start from public.commerce_ml_performance_reports_v1 where id = v_rb)
        order by period_end desc, id desc limit 1;
    end if;
  end if;

  with sales as (
    select s.external_listing_id as ext,
      coalesce(sum(s.units) filter (where s.sale_date between p_cur_start and p_cur_end), 0)::bigint as uc,
      coalesce(sum(s.units) filter (where s.sale_date between p_prev_start and p_prev_end), 0)::bigint as up,
      max(s.sale_date) filter (where s.units > 0) as last_sale,
      min(s.sale_date) filter (where s.units > 0) as first_sale
    from public.commerce_current_sales_listing_daily_v1 s
    where s.platform_code = p_platform
    group by s.external_listing_id
  ),
  lst as (
    select l.external_listing_id as ext, count(*) as n, max(l.id) as listing_id, max(l.title) as title,
      max(l.listing_status) as status, max(l.last_checked_at) as checked
    from public.commerce_listings l
    join public.commerce_marketplaces m on m.id = l.marketplace_id
    where (p_platform = 'SHOPEE' and m.code = 'SHOPEE')
       or (p_platform <> 'SHOPEE' and m.code = 'MERCADO_LIVRE' and l.account_code = v_acct)
    group by l.external_listing_id
  ),
  pfr as (
    select report_id as rid, external_item_id as ext, count(*) as n,
      sum(impressions)::bigint as imp, sum(clicks)::bigint as clk, sum(visitors)::bigint as vis, sum(orders_placed)::bigint as ord
    from public.commerce_shopee_performance_rows_v1
    where p_platform = 'SHOPEE' and report_id in (v_rb, v_ra)
    group by report_id, external_item_id
    union all
    select report_id, external_listing_id, count(*), null::bigint, null::bigint, sum(visits)::bigint, sum(sales_count)::bigint
    from public.commerce_ml_performance_rows_v1
    where p_platform <> 'SHOPEE' and report_id in (v_rb, v_ra)
    group by report_id, external_listing_id
  ),
  rmeta as (
    select 'latest'::text as k, id, period_start as ps, period_end as pe, imported_at from public.commerce_shopee_performance_reports_v1
      where p_platform = 'SHOPEE' and id = v_rb
    union all
    select 'previous', id, period_start, period_end, imported_at from public.commerce_shopee_performance_reports_v1
      where p_platform = 'SHOPEE' and id = v_ra
    union all
    select 'latest', id, period_start, period_end, imported_at from public.commerce_ml_performance_reports_v1
      where p_platform <> 'SHOPEE' and id = v_rb
    union all
    select 'previous', id, period_start, period_end, imported_at from public.commerce_ml_performance_reports_v1
      where p_platform <> 'SHOPEE' and id = v_ra
  ),
  uni as (
    select ext from sales where uc > 0 or up > 0
    union
    select ext from pfr where rid = v_rb
  ),
  joined as (
    select u.ext, coalesce(s.uc, 0) as uc, coalesce(s.up, 0) as up, s.last_sale, s.first_sale,
      (l.ext is not null) as registered, coalesce(l.n, 0) as n,
      case when l.n = 1 then l.listing_id end as listing_id,
      case when l.n = 1 then l.title end as title,
      case when l.n = 1 then l.status end as status,
      case when l.n = 1 then l.checked end as checked,
      pl.n as pl_n, pl.imp as pl_imp, pl.clk as pl_clk, pl.vis as pl_vis, pl.ord as pl_ord,
      pp.n as pp_n, pp.imp as pp_imp, pp.clk as pp_clk, pp.vis as pp_vis, pp.ord as pp_ord
    from uni u
    left join sales s on s.ext = u.ext
    left join lst l on l.ext = u.ext
    left join pfr pl on pl.rid = v_rb and pl.ext = u.ext
    left join pfr pp on pp.rid = v_ra and pp.ext = u.ext
  )
  select jsonb_build_object(
    'platform', p_platform,
    'current', jsonb_build_object('start', p_cur_start, 'end', p_cur_end),
    'previous', jsonb_build_object('start', p_prev_start, 'end', p_prev_end),
    'totals', (select jsonb_build_object(
        'listings', count(*),
        'listings_with_sales', count(*) filter (where uc > 0 or up > 0),
        'units_current', coalesce(sum(uc), 0),
        'units_previous', coalesce(sum(up), 0),
        'listings_unregistered', count(*) filter (where (uc > 0 or up > 0) and not registered),
        'units_current_unregistered', coalesce(sum(uc) filter (where not registered), 0),
        'units_previous_unregistered', coalesce(sum(up) filter (where not registered), 0),
        'listings_ambiguous_status', count(*) filter (where n > 1)
      ) from joined),
    'row_count', (select count(*) from joined),
    'truncated', (select count(*) > p_limit from joined),
    'reports', jsonb_build_object(
      'latest', (select jsonb_build_object('start', ps, 'end', pe, 'imported_at', imported_at,
          'store_visits', (select sum(vis) from pfr where rid = v_rb and n = 1),
          'store_orders', (select sum(ord) from pfr where rid = v_rb and n = 1))
        from rmeta where k = 'latest'),
      'previous', (select jsonb_build_object('start', ps, 'end', pe, 'imported_at', imported_at) from rmeta where k = 'previous')
    ),
    'rows', (select coalesce(jsonb_agg(x.o order by x.uc + x.up desc, x.ext), '[]'::jsonb) from (
        select j.ext, j.uc, j.up, jsonb_build_object(
          'ext', j.ext,
          'listing_id', j.listing_id,
          'title', j.title,
          'registered', j.registered,
          'ambiguous_status', j.n > 1,
          'status', j.status,
          'status_checked_at', j.checked,
          'units_current', j.uc,
          'units_previous', j.up,
          'last_sale', j.last_sale,
          'first_sale', j.first_sale,
          'perf', jsonb_build_object(
            'latest', case when j.pl_n is null then null else jsonb_build_object(
              'ambiguous_rows', j.pl_n > 1,
              'impressions', case when j.pl_n = 1 then j.pl_imp end, 'clicks', case when j.pl_n = 1 then j.pl_clk end,
              'visits', case when j.pl_n = 1 then j.pl_vis end, 'orders', case when j.pl_n = 1 then j.pl_ord end) end,
            'previous', case when j.pp_n is null then null else jsonb_build_object(
              'ambiguous_rows', j.pp_n > 1,
              'impressions', case when j.pp_n = 1 then j.pp_imp end, 'clicks', case when j.pp_n = 1 then j.pp_clk end,
              'visits', case when j.pp_n = 1 then j.pp_vis end, 'orders', case when j.pp_n = 1 then j.pp_ord end) end)
        ) as o
        from joined j order by j.uc + j.up desc, j.ext limit p_limit
      ) x)
  ) into r;

  return r;
end;
$fn$;

comment on function public.commerce_decision_units_v1(text, date, date, date, date, integer) is
  'GA-014: unidades por anúncio (atual x anterior) de UMA conta, situação cadastrada e desempenho comparável. Só leitura, sem receita.';

revoke all on function public.commerce_decision_units_v1(text, date, date, date, date, integer) from public, anon, authenticated;
grant execute on function public.commerce_decision_units_v1(text, date, date, date, date, integer) to service_role;
