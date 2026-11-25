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
  v_ok integer;
  v_keys integer;
  v_prod integer;
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
  -- Cada elemento precisa ser objeto com key/start/end TEXTO (nulo, número ou objeto são recusados), datas reais, 1 a 93 dias.
  -- Qualquer elemento inválido derruba a chamada (nunca é ignorado em silêncio).
  begin
    select count(*) filter (where jsonb_typeof(e) = 'object'
          and jsonb_typeof(e->'key') = 'string' and (e->>'key') ~ '^[A-Za-z0-9_:.-]{1,24}$'
          and jsonb_typeof(e->'start') = 'string' and (e->>'start') ~ '^\d{4}-\d{2}-\d{2}$'
          and jsonb_typeof(e->'end') = 'string' and (e->>'end') ~ '^\d{4}-\d{2}-\d{2}$'
          and (e->>'end')::date >= (e->>'start')::date
          and (e->>'end')::date - (e->>'start')::date + 1 <= 93),
      count(distinct e->>'key'),
      min((e->>'start')::date) filter (where jsonb_typeof(e) = 'object'),
      max((e->>'end')::date) filter (where jsonb_typeof(e) = 'object')
    into v_ok, v_keys, v_lo, v_hi
    from jsonb_array_elements(p_periods) e;
  exception when others then
    raise exception 'abc_units: períodos inválidos' using errcode = '22023';
  end;
  if v_ok is distinct from v_n then
    raise exception 'abc_units: chave, datas ou tamanho de período inválidos (1 a 93 dias)' using errcode = '22023';
  end if;
  if v_keys <> v_n then
    raise exception 'abc_units: chaves repetidas' using errcode = '22023';
  end if;
  if v_hi - v_lo + 1 > 800 then
    raise exception 'abc_units: intervalo total acima de 800 dias' using errcode = '22023';
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
  ), lk as (
    -- Vínculo COMPROVADO de identidade: códigos brutos diferentes do canônico que o apelido revisado já unificou neste produto.
    select c.canon, (array_agg(distinct c.sku order by c.sku))[1:5] linked
    from cm c where c.canon is not null and c.sku <> c.canon
      and exists (select 1 from prod p2 where p2.canon = c.canon) group by c.canon
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
    'products', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('sku', pr.canon, 'units', pr.units, 'linked_from', to_jsonb(lk.linked))) order by pr.total desc, pr.canon)
      from prod pr left join lk on lk.canon = pr.canon), '[]'::jsonb)
  ) into r;

  v_prod := (r->>'product_count')::integer;
  if v_prod > 5000 then
    raise exception 'abc_units: população acima de 5000 produtos' using errcode = '54000';
  end if;
  -- A lista nunca pode ser truncada nem repetir SKU: contagem declarada = tamanho da lista = SKUs distintos.
  if jsonb_array_length(r->'products') <> v_prod
     or (select count(distinct e->>'sku') from jsonb_array_elements(r->'products') e) <> v_prod then
    raise exception 'abc_units: lista de produtos incompleta ou com SKU repetido' using errcode = 'XX001';
  end if;
  return r;
end;
$fn$;

comment on function public.commerce_abc_units_monthly_v1(text, jsonb) is
  'GA-015: unidades por SKU canônico em cada período (mês ou janela, atravessando meses) de UMA conta, com totais para conciliação. Só leitura, só unidades.';

revoke all on function public.commerce_abc_units_monthly_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.commerce_abc_units_monthly_v1(text, jsonb) to service_role;

-- commerce_abc_names_v1(p_platform, p_skus): nomes SOMENTE para SKUs canônicos com vínculo confiável e SEM ambiguidade (1 a 300 SKUs exibidos).
--   source = 'CADASTRO'  -> o SKU normalizado corresponde a EXATAMENTE um produto do catálogo;
--   source = 'VENDA'     -> sem cadastro; a venda DA CONTA PEDIDA com o mesmo código tem exatamente um nome distinto;
--   mais de um produto/nome para o mesmo código -> ambiguidade: o SKU não aparece na resposta (a tela mostra só o código).
--   Nunca escolhe um nome por LIMIT 1 nem por ordenação arbitrária.
create or replace function public.commerce_abc_names_v1(p_platform text, p_skus jsonb) returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $fn$
declare
  v_n integer;
  r jsonb;
begin
  if p_platform is null or p_platform not in ('SHOPEE', 'ML_ANTIGO', 'ML_NOVO') then
    raise exception 'abc_names: plataforma inválida' using errcode = '22023';
  end if;
  if p_skus is null or jsonb_typeof(p_skus) <> 'array' then
    raise exception 'abc_names: SKUs devem ser uma lista' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_skus);
  if v_n < 1 or v_n > 300 then
    raise exception 'abc_names: entre 1 e 300 SKUs' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_skus) e where jsonb_typeof(e) <> 'string' or length(e #>> '{}') not between 1 and 80) then
    raise exception 'abc_names: SKU inválido' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku', x.sku, 'name', x.name, 'source', x.src) order by x.sku), '[]'::jsonb) into r
  from (
    select s.sku,
      case when c.n_prod > 0 then case when c.n_prod = 1 then c.name end else v.name end name,
      case when c.n_prod > 0 then case when c.n_prod = 1 then 'CADASTRO' end when v.name is not null then 'VENDA' end src
    from (select distinct e #>> '{}' sku from jsonb_array_elements(p_skus) e) s
    -- catálogo: quantos produtos distintos têm este SKU normalizado (ambíguo = mais de um) e o nome quando for um só
    left join lateral (select count(distinct pp.id)::int n_prod, min(btrim(pp.name)) filter (where nullif(btrim(pp.name), '') is not null) name
      from public.commerce_product_skus ps join public.commerce_products pp on pp.id = ps.product_id
      where upper(regexp_replace(ps.sku, '[\s_]+', '', 'g')) = s.sku) c on true
    -- venda DA CONTA pedida: só vale com exatamente um nome distinto para o código
    left join lateral (select min(btrim(rr.product_name)) name
      from public.commerce_sales_rows rr
      where coalesce(c.n_prod, 0) = 0 and rr.platform_code = p_platform
        and upper(regexp_replace(coalesce(rr.sku_norm, rr.sku), '[\s_]+', '', 'g')) = s.sku and nullif(btrim(rr.product_name), '') is not null
      having count(distinct btrim(rr.product_name)) = 1) v on true
  ) x where x.name is not null;
  return r;
end;
$fn$;
comment on function public.commerce_abc_names_v1(text, jsonb) is
  'GA-015: nome por SKU canônico só com vínculo confiável e sem ambiguidade (cadastro com um único produto, ou venda da própria conta com um único nome). Só leitura.';
revoke all on function public.commerce_abc_names_v1(text, jsonb) from public, anon, authenticated;
grant execute on function public.commerce_abc_names_v1(text, jsonb) to service_role;
