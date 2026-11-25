-- GA-015 — Evolução da Curva ABC por produto/SKU: fonte de leitura por unidades (SOMENTE UNIDADES).
-- Migração preparada como ARQUIVO. NÃO é aplicada pelo deploy; só será aplicada no Supabase com autorização do dono.
--
-- commerce_abc_units_monthly_v1(p_platform, p_periods)
--   p_periods = jsonb array de {"key":"2026-10","start":"2026-10-01","end":"2026-10-31"}. Cada período pode ser um mês
--   OU qualquer janela (7/30 dias, mês do ano anterior) e pode atravessar meses. Entre 1 e 24 períodos, de 1 a 93 dias,
--   chaves únicas. Períodos podem se sobrepor (a função só soma, não decide comparação).
--   Devolve, para UMA conta (SHOPEE, ML_ANTIGO ou ML_NOVO), as unidades por SKU canônico em cada período e os totais
--   do período para conciliação (GA-019/GA-021, feita no Worker).
--
-- Identidade = conta + SKU canônico (commerce_sku_canon_v1, que já aplica os apelidos de SKU revisados). Vendas sem SKU
-- ficam FORA da lista de produtos mas DENTRO do total (no_sku_units): nunca viram um produto único "sem SKU".
-- Fonte: Shopee = fonte por SKU da GA-021 (commerce_shopee_current_sku_daily_v1, mesmo total da GA-019);
--        ML = commerce_current_sales_listing_daily_v1 filtrada pela conta.
-- Só lê unidades (a coluna de receita nunca é usada), não classifica, não consulta cobertura (GA-018), não grava nada.
-- A população é COMPLETA: não há limite que corte a lista; se passar de 5000 produtos a função falha em vez de truncar.
-- Só consultas (sem tabelas temporárias): é STABLE e pode rodar em transação somente leitura.
-- Produto com soma <= 0 no período (devolução/estorno) não entra na lista; as unidades ficam em sku_units e nonpositive_units.
create or replace function public.commerce_abc_units_monthly_v1(
  p_platform text,
  p_periods jsonb
) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
  v_bad boolean;
  v_lo date;
  v_hi date;
  r jsonb;
begin
  if p_platform is null or p_platform not in ('SHOPEE', 'ML_ANTIGO', 'ML_NOVO') then
    raise exception 'abc_units: plataforma inválida' using errcode = '22023';
  end if;
  if p_periods is null or jsonb_typeof(p_periods) <> 'array' then
    raise exception 'abc_units: períodos devem ser uma lista' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_periods);
  if v_n < 1 or v_n > 24 then
    raise exception 'abc_units: entre 1 e 24 períodos' using errcode = '22023';
  end if;
  begin
    select bool_or(jsonb_typeof(e) <> 'object' or e->>'key' is null or (e->>'key') !~ '^[A-Za-z0-9_:.-]{1,24}$'
        or (e->>'start') !~ '^\d{4}-\d{2}-\d{2}$' or (e->>'end') !~ '^\d{4}-\d{2}-\d{2}$'
        or (e->>'end')::date < (e->>'start')::date or (e->>'end')::date - (e->>'start')::date + 1 > 93),
      min((e->>'start')::date), max((e->>'end')::date)
    into v_bad, v_lo, v_hi
    from jsonb_array_elements(p_periods) e;
  exception when others then
    raise exception 'abc_units: períodos inválidos' using errcode = '22023';
  end;
  if v_bad is distinct from false then
    raise exception 'abc_units: chave, datas ou tamanho de período inválidos (1 a 93 dias)' using errcode = '22023';
  end if;
  if (select count(distinct e->>'key') from jsonb_array_elements(p_periods) e) <> v_n then
    raise exception 'abc_units: chaves repetidas' using errcode = '22023';
  end if;

  with per as (
    select o::integer ord, e->>'key' key, (e->>'start')::date d1, (e->>'end')::date d2
    from jsonb_array_elements(p_periods) with ordinality t(e, o)
  ), src as (
    select sale_date, nullif(btrim(sku_norm), '') sku, coalesce(units, 0)::bigint units
    from public.commerce_shopee_current_sku_daily_v1
    where p_platform = 'SHOPEE' and sale_date between v_lo and v_hi
    union all
    select sale_date, nullif(btrim(sku_norm), ''), coalesce(units, 0)::bigint
    from public.commerce_current_sales_listing_daily_v1
    where p_platform <> 'SHOPEE' and platform_code = p_platform and sale_date between v_lo and v_hi
  ), cm as (
    select s.sku, nullif(public.commerce_sku_canon_v1(s.sku), '') canon
    from (select distinct sku from src where sku is not null) s
  ), agg as (
    select p.key, cm.canon, sum(s.units)::bigint u
    from per p join src s on s.sale_date between p.d1 and p.d2
    left join cm on cm.sku = s.sku
    group by 1, 2
  ), per_tot as (
    select p.ord, p.key, p.d1, p.d2,
      (select count(distinct s.sale_date) from src s where s.sale_date between p.d1 and p.d2) days_with_data,
      coalesce((select sum(a.u) from agg a where a.key = p.key), 0) total_units,
      coalesce((select sum(a.u) from agg a where a.key = p.key and a.canon is not null), 0) sku_units,
      coalesce((select sum(a.u) from agg a where a.key = p.key and a.canon is null), 0) no_sku_units,
      coalesce((select sum(a.u) from agg a where a.key = p.key and a.canon is not null and a.u > 0), 0) ranked_units,
      (select count(*) from agg a where a.key = p.key and a.canon is not null and a.u > 0) products
    from per p
  ), prod as (
    select a.canon, jsonb_object_agg(a.key, a.u) units, sum(a.u) total
    from agg a where a.canon is not null and a.u > 0 group by a.canon
  )
  select jsonb_build_object(
    'platform', p_platform,
    'source', case when p_platform = 'SHOPEE' then 'SKU_SHOPEE' else 'ANUNCIOS_ML' end,
    'periods', (select jsonb_agg(jsonb_build_object(
        'key', t.key, 'start', t.d1, 'end', t.d2, 'days', t.d2 - t.d1 + 1, 'days_with_data', t.days_with_data,
        'total_units', t.total_units, 'sku_units', t.sku_units, 'no_sku_units', t.no_sku_units,
        'ranked_units', t.ranked_units, 'nonpositive_units', t.sku_units - t.ranked_units, 'products', t.products) order by t.ord)
      from per_tot t),
    'product_count', (select count(*) from prod),
    'products', coalesce((select jsonb_agg(jsonb_build_object('sku', canon, 'units', units) order by total desc, canon) from prod), '[]'::jsonb)
  ) into r;

  if (r->>'product_count')::integer > 5000 then
    raise exception 'abc_units: população acima de 5000 produtos' using errcode = '54000';
  end if;
  return r;
end;
$fn$;

comment on function public.commerce_abc_units_monthly_v1(text, jsonb) is
  'GA-015: unidades por SKU canônico em cada período (mês ou janela, atravessando meses) de UMA conta, com totais para conciliação. Só leitura, só unidades.';

revoke all on function public.commerce_abc_units_monthly_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.commerce_abc_units_monthly_v1(text, jsonb) to service_role;
