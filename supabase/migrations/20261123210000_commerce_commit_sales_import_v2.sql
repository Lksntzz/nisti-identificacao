-- GA-019 / BUG-GA-001: commit de importação de vendas por DIA (v2).
-- A v1 (commerce_commit_sales_import_v1) continua instalada, intacta, para reversão.
--
-- Problema da v1: trocava o MÊS INTEIRO da plataforma pelo conteúdo do arquivo. Importação incremental
-- (só dias novos) apagava os dias anteriores do mês e gerava resumos incompletos.
--
-- Regras da v2:
--  * Cobertura comprovada = datas OBSERVADAS nos pedidos do arquivo (mín..máx). Dia dentro do intervalo sem
--    venda = "sem vendas" confirmado; dia fora = "sem informação". O nome do arquivo não define cobertura.
--  * Por dia, o lote mais novo substitui o antigo (mesma regra da view e do gatilho de substituição por dia),
--    com duas proteções: dia PARCIAL (último dia do arquivo, exportado no próprio dia) não substitui dia
--    COMPLETO; e dia "sem vendas" não apaga dia que já tem vendas.
--  * Os meses tocados são RECONSTRUÍDOS a partir de todos os dias vencedores (dias anteriores preservados).
--    Plataformas e meses não tocados são copiados do snapshot anterior.
--  * Pedidos únicos = pedidos distintos pelo identificador (hash) por dia, inclusive entre arquivos em partes.
--    Nunca soma de "pedidos por SKU". Se não for possível calcular exato (dia antigo sem identificador),
--    o commit falha com sales_import_orders_unresolved em vez de estimar.
--  * Arquivos Order.toship (pedidos para enviar) são barrados até a finalidade ser validada.
--  * Trava global (advisory lock) para commits simultâneos; tudo numa transação: falhou, nada fica.
--  * Cache: commerce_data_version_v1() muda só quando o lote vira COMMITTED, então o cache só é invalidado
--    após commit bem-sucedido. A função não escreve em cache.
--  * Só service_role executa.

-- 1) Identificadores de pedido (hash, nunca o número real) por dia e lote.
create table if not exists public.commerce_sales_import_stage_orders_v2 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  sale_date date not null,
  order_key text not null check (order_key ~ '^[0-9a-f]{32}$'),
  primary key (batch_id, sale_date, order_key)
);
alter table public.commerce_sales_import_stage_orders_v2 enable row level security;
revoke all on public.commerce_sales_import_stage_orders_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.commerce_sales_import_stage_orders_v2 to service_role;

-- 2) Cobertura por dia gravada no commit (dia com venda, dia confirmado sem venda, dia final ou parcial, aplicado ou mantido).
create table if not exists public.commerce_sales_day_coverage_v2 (
  batch_id bigint not null references public.commerce_sales_import_batches(id) on delete cascade,
  platform_code text not null check (platform_code in ('SHOPEE','ML_NOVO','ML_ANTIGO')),
  sale_date date not null,
  has_sales boolean not null,
  is_final boolean not null,
  applied boolean not null default true,
  skip_reason text,
  primary key (batch_id, sale_date)
);
create index if not exists commerce_sales_day_coverage_v2_day_idx
  on public.commerce_sales_day_coverage_v2 (platform_code, sale_date);
alter table public.commerce_sales_day_coverage_v2 enable row level security;
revoke all on public.commerce_sales_day_coverage_v2 from public, anon, authenticated;
grant select, insert, update, delete on public.commerce_sales_day_coverage_v2 to service_role;

-- 3) Envio dos identificadores (até 5000 por chamada).
create or replace function public.commerce_append_sales_import_orders_v2(p_batch_id bigint, p_rows jsonb)
returns integer language plpgsql security invoker set search_path=public as $fn$
declare v_count integer;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'sales_import_orders_array_required' using errcode='22023';
  end if;
  if not exists(select 1 from public.commerce_sales_import_batches b
    where b.id=p_batch_id and b.status in ('UPLOADED','STAGED')) then
    raise exception 'sales_import_batch_closed' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x
    where (x->>'d') is null or (x->>'d') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
       or (x->>'k') is null or (x->>'k') !~ '^[0-9a-f]{32}$') then
    raise exception 'sales_import_orders_invalid' using errcode='22023';
  end if;
  insert into public.commerce_sales_import_stage_orders_v2(batch_id, sale_date, order_key)
  select p_batch_id, (x->>'d')::date, x->>'k' from jsonb_array_elements(p_rows) x
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $fn$;
revoke all on function public.commerce_append_sales_import_orders_v2(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.commerce_append_sales_import_orders_v2(bigint, jsonb) to service_role;

-- 4) Vencedor por dia: lote COMMITTED de maior snapshot (partes do mesmo snapshot somam).
--    kind: V2 (cobertura gravada), LEGACY_SKU (Shopee antigo, vendas por SKU/dia) ou LEGACY_STAGE (ML antigo, linhas diárias).
create or replace function public.commerce_sales_day_winners_v2(p_platform text, p_from date, p_to date)
returns table(sale_date date, batch_id bigint, snapshot_id bigint, kind text, is_final boolean, has_sales boolean)
language sql stable security invoker set search_path=public as $fn$
  with cand as (
    select c.sale_date, c.batch_id, b.snapshot_id, 'V2'::text as kind, c.is_final, c.has_sales
    from public.commerce_sales_day_coverage_v2 c
    join public.commerce_sales_import_batches b on b.id = c.batch_id
    where c.platform_code = p_platform and c.applied
      and b.status = 'COMMITTED' and b.snapshot_id is not null
      and c.sale_date between p_from and p_to
    union all
    select d.sale_date, d.batch_id, b.snapshot_id, 'LEGACY_SKU'::text,
      ((b.committed_at at time zone 'America/Sao_Paulo')::date > d.sale_date), true
    from (select distinct s.batch_id, s.sale_date from public.commerce_shopee_sales_sku_daily_v1 s
          where s.sale_date between p_from and p_to) d
    join public.commerce_sales_import_batches b on b.id = d.batch_id
    where p_platform = 'SHOPEE' and b.platform_code = 'SHOPEE'
      and b.status = 'COMMITTED' and b.snapshot_id is not null
      and not exists(select 1 from public.commerce_sales_day_coverage_v2 l where l.batch_id = d.batch_id)
    union all
    select r.d, r.batch_id, b.snapshot_id, 'LEGACY_STAGE'::text,
      ((b.committed_at at time zone 'America/Sao_Paulo')::date > r.d), true
    from (select distinct sr.batch_id, sr.period_start as d from public.commerce_sales_import_stage_rows sr
          where sr.period_start = sr.period_end and sr.period_start between p_from and p_to) r
    join public.commerce_sales_import_batches b on b.id = r.batch_id
    where p_platform in ('ML_NOVO','ML_ANTIGO') and b.platform_code = p_platform
      and b.status = 'COMMITTED' and b.snapshot_id is not null
      and not exists(select 1 from public.commerce_sales_day_coverage_v2 l where l.batch_id = r.batch_id)
  ), ranked as (
    select cand.*, dense_rank() over (partition by cand.sale_date order by cand.snapshot_id desc) as rk from cand
  )
  select ranked.sale_date, ranked.batch_id, ranked.snapshot_id, ranked.kind, ranked.is_final, ranked.has_sales
  from ranked where ranked.rk = 1;
$fn$;
revoke all on function public.commerce_sales_day_winners_v2(text, date, date) from public, anon, authenticated;
grant execute on function public.commerce_sales_day_winners_v2(text, date, date) to service_role;

-- 5) Linhas por dia dos dias vencedores (SKU/anúncio, unidades, receita).
create or replace function public.commerce_sales_day_rows_v2(p_platform text, p_from date, p_to date)
returns table(sale_date date, sku_primary text, sku text, sku_norm text, product_name text, variation text,
  units integer, orders_with_item integer, product_revenue numeric)
language sql stable security invoker set search_path=public as $fn$
  with w as materialized (select * from public.commerce_sales_day_winners_v2(p_platform, p_from, p_to)),
  attr as (
    select distinct on (r.sku_norm) r.sku_norm, r.sku_primary, r.sku, r.product_name, r.variation
    from public.commerce_sales_import_stage_rows r
    join public.commerce_sales_import_batches b on b.id = r.batch_id
    where b.platform_code = p_platform and b.status = 'COMMITTED'
    order by r.sku_norm, r.batch_id desc, r.source_row_number desc
  )
  select w.sale_date, r.sku_primary, r.sku, r.sku_norm, r.product_name, r.variation,
    r.units, r.orders_with_item, r.product_revenue
  from w join public.commerce_sales_import_stage_rows r
    on r.batch_id = w.batch_id and r.period_start = w.sale_date and r.period_start = r.period_end
  where w.kind in ('V2','LEGACY_STAGE')
  union all
  select w.sale_date, a.sku_primary, coalesce(a.sku, s.sku_norm), s.sku_norm, a.product_name, a.variation,
    s.units, s.orders_with_item, s.product_revenue
  from w join public.commerce_shopee_sales_sku_daily_v1 s on s.batch_id = w.batch_id and s.sale_date = w.sale_date
  left join attr a on a.sku_norm = s.sku_norm
  where w.kind = 'LEGACY_SKU';
$fn$;
revoke all on function public.commerce_sales_day_rows_v2(text, date, date) from public, anon, authenticated;
grant execute on function public.commerce_sales_day_rows_v2(text, date, date) to service_role;

-- 6) Pedidos únicos do mês. Devolve {orders:null,...} quando não dá para calcular exato (nunca estima).
--    V2: pedidos distintos por dia (identificador). ML antigo: pedidos únicos do dia do próprio arquivo.
--    Shopee antigo: só vale o bloco de pedidos do arquivo se nenhum dia dele foi substituído e ele não tem partes.
create or replace function public.commerce_sales_month_orders_v2(p_platform text, p_month date)
returns jsonb language plpgsql stable security invoker set search_path=public as $fn$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_orders bigint := 0;
  v_bad jsonb := '[]'::jsonb;
begin
  with w as materialized (select * from public.commerce_sales_day_winners_v2(p_platform, v_from, v_to)),
  v2 as (
    select count(*) as n from (
      select distinct o.sale_date, o.order_key
      from w join public.commerce_sales_import_stage_orders_v2 o on o.batch_id = w.batch_id and o.sale_date = w.sale_date
      where w.kind = 'V2') q
  ),
  ml as (
    select w.sale_date, (select sum(s.net_orders) from public.commerce_sales_import_stage_summary s
        where s.batch_id = w.batch_id and s.period_start = w.sale_date and s.period_end = w.sale_date) as n
    from w where w.kind = 'LEGACY_STAGE'
  ),
  sh as (
    select w.batch_id,
      count(distinct w.sale_date) as won,
      (select count(*) from (
          select s.sale_date from public.commerce_shopee_sales_sku_daily_v1 s
            where s.batch_id = w.batch_id and s.sale_date between v_from and v_to
          union
          select x.sale_date from public.commerce_shopee_sku_daily_superseded_v1 x
            where x.batch_id = w.batch_id and x.sale_date between v_from and v_to) q) as orig,
      (select count(*) from public.commerce_sales_import_batches b2
        where b2.platform_code = 'SHOPEE' and b2.status = 'COMMITTED'
          and b2.snapshot_id = (select b1.snapshot_id from public.commerce_sales_import_batches b1 where b1.id = w.batch_id)) as grp,
      (select sum(s.net_orders) from public.commerce_sales_import_stage_summary s
        where s.batch_id = w.batch_id and date_trunc('month', s.period_start)::date = v_from) as block
    from w where w.kind = 'LEGACY_SKU' group by w.batch_id
  )
  select
    (select n from v2) + coalesce((select sum(n) from ml where n is not null), 0)
      + coalesce((select sum(block) from sh where won = orig and grp = 1 and block is not null), 0),
    (select coalesce(jsonb_agg(jsonb_build_object('kind','ML_DAY_WITHOUT_SUMMARY','date',sale_date)), '[]'::jsonb) from ml where n is null)
    || (select coalesce(jsonb_agg(jsonb_build_object('kind','SHOPEE_LEGACY_BLOCK','batch_id',batch_id,
          'days_kept',won,'days_original',orig,'parts',grp)), '[]'::jsonb)
        from sh where not (won = orig and grp = 1 and block is not null))
  into v_orders, v_bad;
  if jsonb_array_length(v_bad) > 0 then
    return jsonb_build_object('orders', null, 'unresolved', v_bad);
  end if;
  return jsonb_build_object('orders', v_orders, 'unresolved', '[]'::jsonb);
end $fn$;
revoke all on function public.commerce_sales_month_orders_v2(text, date) from public, anon, authenticated;
grant execute on function public.commerce_sales_month_orders_v2(text, date) to service_role;

-- 7) Commit v2.
create or replace function public.commerce_commit_sales_import_v2(p_batch_id bigint)
returns jsonb language plpgsql security invoker set search_path=public as $fn$
declare
  v_batch public.commerce_sales_import_batches%rowtype;
  v_platform text;
  v_part_match text[];
  v_part_count integer := 1;
  v_group_key text := null;
  v_group bigint[] := array[p_batch_id];
  v_parts_found integer := 1;
  v_old bigint; v_new bigint;
  v_start date; v_end date; v_created date; v_final_through date;
  v_months date[]; v_from date; v_to date; m date;
  v_ord jsonb; v_rows integer; v_sums integer;
  v_prev numeric; v_recon numeric; v_prev_units numeric[]; v_pre_units numeric[]; i integer;
begin
  -- Trava global: dois commits nunca montam snapshot ao mesmo tempo (liberada no fim da transação).
  perform pg_advisory_xact_lock(hashtextextended('commerce_sales_commit', 2026));

  select * into v_batch from public.commerce_sales_import_batches where id = p_batch_id for update;
  if not found then raise exception 'sales_import_batch_not_found' using errcode='22023'; end if;
  v_platform := v_batch.platform_code;

  if v_batch.status = 'COMMITTED' and v_batch.snapshot_id is not null then
    return jsonb_build_object('status','COMMITTED','batch_id',v_batch.id,'snapshot_id',v_batch.snapshot_id,'already_committed',true);
  end if;

  if v_batch.source_filename ~* 'order[.]toship' then
    raise exception 'sales_import_toship_blocked' using errcode='22023',
      detail='Arquivos "Order.toship" (pedidos para enviar) não podem substituir vendas confirmadas até a finalidade ser validada.';
  end if;

  if not exists(select 1 from public.commerce_sales_import_stage_rows where batch_id = p_batch_id) then
    raise exception 'sales_import_no_rows' using errcode='22023';
  end if;

  v_part_match := regexp_match(v_batch.source_filename, '_part_([0-9]+)_of_([0-9]+)[.]xlsx$', 'i');
  if v_part_match is not null then
    v_part_count := greatest(v_part_match[2]::integer, 1);
    v_group_key := regexp_replace(v_batch.source_filename, '_part_[0-9]+_of_[0-9]+[.]xlsx$', '.xlsx', 'i');
    select coalesce(array_agg(chosen.id order by chosen.part_no), array[]::bigint[]), count(*)::integer
      into v_group, v_parts_found
    from (
      select distinct on (candidate.part_no) candidate.id, candidate.part_no
      from (
        select b.id, ((regexp_match(b.source_filename, '_part_([0-9]+)_of_([0-9]+)[.]xlsx$', 'i'))[1])::integer as part_no
        from public.commerce_sales_import_batches b
        where b.platform_code = v_platform and b.status = 'STAGED'
          and regexp_replace(b.source_filename, '_part_[0-9]+_of_[0-9]+[.]xlsx$', '.xlsx', 'i') = v_group_key
          and coalesce(((regexp_match(b.source_filename, '_part_([0-9]+)_of_([0-9]+)[.]xlsx$', 'i'))[2])::integer, 0) = v_part_count
      ) candidate
      where candidate.part_no between 1 and v_part_count
      order by candidate.part_no, candidate.id desc
    ) chosen;
    if v_parts_found < v_part_count then
      return jsonb_build_object('status','WAITING_PARTS','batch_id',p_batch_id,'multipart_group',v_group_key,
        'parts_received',v_parts_found,'parts_expected',v_part_count,
        'missing_parts',(select coalesce(jsonb_agg(pn order by pn), '[]'::jsonb) from generate_series(1, v_part_count) pn
          where not exists(select 1 from unnest(v_group) gid join public.commerce_sales_import_batches gb on gb.id = gid
            where ((regexp_match(gb.source_filename, '_part_([0-9]+)_of_([0-9]+)[.]xlsx$', 'i'))[1])::integer = pn)));
    end if;
  end if;

  -- O lote precisa vir em formato por dia, com identificadores de pedido (importador atualizado).
  if exists(select 1 from public.commerce_sales_import_stage_rows where batch_id = any(v_group) and period_start <> period_end) then
    raise exception 'sales_import_day_level_required' using errcode='22023',
      detail='O arquivo foi preparado no formato mensal antigo. Atualize a página e importe de novo.';
  end if;
  if not exists(select 1 from public.commerce_sales_import_stage_orders_v2 where batch_id = any(v_group)) then
    raise exception 'sales_import_orders_required' using errcode='22023',
      detail='Faltam os identificadores de pedido do arquivo. Atualize a página e importe de novo.';
  end if;
  if exists(
      (select r.period_start from public.commerce_sales_import_stage_rows r where r.batch_id = any(v_group)
       except select o.sale_date from public.commerce_sales_import_stage_orders_v2 o where o.batch_id = any(v_group))
      union all
      (select o.sale_date from public.commerce_sales_import_stage_orders_v2 o where o.batch_id = any(v_group)
       except select r.period_start from public.commerce_sales_import_stage_rows r where r.batch_id = any(v_group))) then
    raise exception 'sales_import_orders_mismatch' using errcode='22023',
      detail='Os dias dos pedidos não batem com os dias das vendas do arquivo.';
  end if;

  -- Cobertura comprovada = datas observadas. Dia final = dia já encerrado quando o arquivo foi gerado/enviado.
  select min(o.sale_date), max(o.sale_date) into v_start, v_end
  from public.commerce_sales_import_stage_orders_v2 o where o.batch_id = any(v_group);
  select min((b.created_at at time zone 'America/Sao_Paulo')::date) into v_created
  from public.commerce_sales_import_batches b where b.id = any(v_group);
  v_final_through := case when v_created > v_end then v_end else v_end - 1 end;

  select id into v_old from public.commerce_sales_snapshots where is_current = true order by id desc limit 1;

  delete from public.commerce_sales_day_coverage_v2 where batch_id = any(v_group);
  insert into public.commerce_sales_day_coverage_v2(batch_id, platform_code, sale_date, has_sales, is_final, applied)
  select coalesce(r.batch_id, p_batch_id), v_platform, d.d, (r.batch_id is not null), (d.d <= v_final_through), true
  from (select g::date as d from generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') g) d
  left join (select distinct sr.batch_id, sr.period_start as sale_date
             from public.commerce_sales_import_stage_rows sr where sr.batch_id = any(v_group)) r on r.sale_date = d.d;

  -- Dia parcial não substitui dia completo; dia "sem vendas" não apaga dia que já tem vendas.
  update public.commerce_sales_day_coverage_v2 l
  set applied = false,
      skip_reason = case when not l.has_sales then 'ZERO_CONFLICT' else 'PARTIAL_DAY' end
  from public.commerce_sales_day_winners_v2(v_platform, v_start, v_end) w
  where l.batch_id = any(v_group) and l.sale_date = w.sale_date and w.has_sales
    and ((not l.has_sales) or (not l.is_final and w.is_final));

  -- Dias mantidos: tira do lote novo os dados diários desses dias (o gatilho não pode substituir o dia antigo).
  delete from public.commerce_shopee_sales_sku_daily_v1 where batch_id = any(v_group)
    and sale_date in (select l.sale_date from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and not l.applied);
  delete from public.commerce_shopee_finance_stage_daily_v1 where batch_id = any(v_group)
    and sale_date in (select l.sale_date from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and not l.applied);
  delete from public.commerce_shopee_full_daily_v1 where batch_id = any(v_group)
    and sale_date in (select l.sale_date from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and not l.applied);
  delete from public.commerce_shopee_order_extras_daily_v1 where batch_id = any(v_group)
    and sale_date in (select l.sale_date from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and not l.applied);
  delete from public.commerce_sales_listing_daily_v1 where batch_id = any(v_group)
    and sale_date in (select l.sale_date from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and not l.applied);

  -- Os dados diários do lote precisam bater com as linhas dele nos dias aplicados.
  if exists(
    with st as (
      select r.period_start as d, sum(r.units) as u from public.commerce_sales_import_stage_rows r
      where r.batch_id = any(v_group) and r.sku_norm <> ''
        and r.period_start in (select l.sale_date from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and l.applied)
      group by 1),
    fc as (
      select s.sale_date as d, sum(s.units) as u from public.commerce_shopee_sales_sku_daily_v1 s
        where v_platform = 'SHOPEE' and s.batch_id = any(v_group) group by 1
      union all
      select s.sale_date, sum(s.units) from public.commerce_sales_listing_daily_v1 s
        where v_platform <> 'SHOPEE' and s.batch_id = any(v_group) group by 1)
    select 1 from st full join fc using (d) where st.u is distinct from fc.u) then
    raise exception 'sales_import_daily_mismatch' using errcode='22023',
      detail='Os totais diários do lote não batem com as linhas importadas.';
  end if;

  -- Meses tocados = meses dos dias aplicados com venda.
  select coalesce(array_agg(distinct date_trunc('month', l.sale_date)::date), array[]::date[]) into v_months
  from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and l.applied and l.has_sales;

  -- Segurança (parte 1): vendas do mês no snapshot atual versus o que os dias já salvos conseguem reconstruir.
  v_prev_units := array[]::numeric[]; v_pre_units := array[]::numeric[];
  if v_old is not null then
    foreach m in array v_months loop
      select coalesce(sum(r.units), 0) into v_prev from public.commerce_sales_rows r
      where r.snapshot_id = v_old and r.platform_code = v_platform and date_trunc('month', r.period_start)::date = m;
      select coalesce(sum(d.units), 0) into v_recon
      from public.commerce_sales_day_rows_v2(v_platform, m, (m + interval '1 month - 1 day')::date) d;
      v_prev_units := v_prev_units || v_prev; v_pre_units := v_pre_units || v_recon;
    end loop;
  end if;

  insert into public.commerce_sales_snapshots(source_name, source_ref, data_through, row_count, summary_row_count, is_current, created_by)
  values('IMPORTAÇÃO COMERCIAL',
    case when v_part_count > 1 then 'sales-import-group-v2:' || coalesce(v_group_key, p_batch_id::text) else 'sales-import-v2:' || p_batch_id::text end,
    v_end, 0, 0, false, v_batch.created_by)
  returning id into v_new;

  -- Vira COMMITTED já com snapshot: o gatilho da Shopee substitui os dias antigos que o lote ganhou.
  update public.commerce_sales_import_batches
  set status = 'COMMITTED', snapshot_id = v_new, committed_at = now()
  where id = any(v_group);

  -- Segurança (parte 2), já com os dias do lote novo: um mês que o snapshot anterior tinha e que os dados diários
  -- não reproduzem (nem antes, nem depois deste lote) não pode ser reconstruído sem perder vendas. Aborta tudo.
  if v_old is not null then
    for i in 1 .. coalesce(array_length(v_months, 1), 0) loop
      if v_prev_units[i] > v_pre_units[i] then
        select coalesce(sum(d.units), 0) into v_recon
        from public.commerce_sales_day_rows_v2(v_platform, v_months[i], (v_months[i] + interval '1 month - 1 day')::date) d;
        if v_prev_units[i] > v_recon then
          raise exception 'sales_import_month_not_rebuildable' using errcode='22023',
            detail = 'O mês ' || to_char(v_months[i], 'YYYY-MM') || ' tem vendas salvas que não existem nos dados diários. Importe o mês inteiro.';
        end if;
      end if;
    end loop;
  end if;

  if array_length(v_months, 1) is not null then
    v_from := (select min(x) from unnest(v_months) x);
    v_to := ((select max(x) from unnest(v_months) x) + interval '1 month - 1 day')::date;
  end if;

  with dr as materialized (
    select * from public.commerce_sales_day_rows_v2(v_platform, coalesce(v_from, current_date), coalesce(v_to, current_date))
    where array_length(v_months, 1) is not null and date_trunc('month', sale_date)::date = any(v_months)
  ),
  mm as (select date_trunc('month', sale_date)::date as ms, max(sale_date) as pe from dr group by 1),
  reb as (
    select mm.ms, mm.pe, dr.sku_primary, dr.sku, dr.sku_norm,
      max(dr.product_name) as product_name, max(dr.variation) as variation,
      sum(dr.units)::integer as units, sum(dr.orders_with_item)::integer as owi,
      round(sum(dr.product_revenue), 2) as rev
    from dr join mm on mm.ms = date_trunc('month', dr.sale_date)::date
    group by mm.ms, mm.pe, dr.sku_primary, dr.sku, dr.sku_norm
  ),
  comb as (
    select r.platform_code, r.period_key, r.period_start, r.period_end, r.sku_primary, r.sku, r.sku_norm,
      r.product_name, r.variation, r.units, r.orders_with_item, r.product_revenue, 0 as so
    from public.commerce_sales_rows r
    where r.snapshot_id = v_old
      and not (r.platform_code = v_platform and date_trunc('month', r.period_start)::date = any(v_months))
    union all
    select v_platform,
      case when pe = (ms + interval '1 month - 1 day')::date then to_char(ms, 'YYYY-MM')
           else to_char(ms, 'YYYY-MM') || ' (01-' || to_char(pe, 'DD') || ')' end,
      ms, pe, sku_primary, sku, sku_norm, product_name, variation, units, owi, rev, 1
    from reb
  ),
  numbered as (
    select row_number() over (order by platform_code, period_start, sku_norm, coalesce(sku_primary, ''), sku, so)::integer as n, comb.*
    from comb
  )
  insert into public.commerce_sales_rows(snapshot_id, source_row_number, platform_code, period_key, period_start, period_end,
    sku_primary, sku, sku_norm, product_name, variation, units, orders_with_item, product_revenue)
  select v_new, n, platform_code, period_key, period_start, period_end,
    sku_primary, sku, sku_norm, product_name, variation, units, orders_with_item, product_revenue
  from numbered;

  insert into public.commerce_sales_summary_rows(snapshot_id, platform_code, period_key, period_start, period_end, net_orders,
    units, product_revenue, listings_with_sales, skus_with_sales)
  select v_new, s.platform_code, s.period_key, s.period_start, s.period_end, s.net_orders, s.units, s.product_revenue,
    s.listings_with_sales, s.skus_with_sales
  from public.commerce_sales_summary_rows s
  where s.snapshot_id = v_old
    and not (s.platform_code = v_platform and date_trunc('month', s.period_start)::date = any(v_months));

  foreach m in array v_months loop
    v_ord := public.commerce_sales_month_orders_v2(v_platform, m);
    if (v_ord->>'orders') is null then
      raise exception 'sales_import_orders_unresolved' using errcode='22023',
        detail = 'Pedidos únicos de ' || to_char(m, 'YYYY-MM') || ' não podem ser calculados com exatidão: ' || (v_ord->'unresolved')::text
          || ' Importe o mês inteiro desta plataforma.';
    end if;
    insert into public.commerce_sales_summary_rows(snapshot_id, platform_code, period_key, period_start, period_end, net_orders,
      units, product_revenue, listings_with_sales, skus_with_sales)
    select v_new, v_platform, r.period_key, m, r.period_end, (v_ord->>'orders')::integer,
      sum(r.units)::integer, round(sum(r.product_revenue), 2),
      count(distinct coalesce(nullif(btrim(coalesce(r.sku_primary, '')), ''), r.sku))::integer,
      count(distinct r.sku_norm)::integer
    from public.commerce_sales_rows r
    where r.snapshot_id = v_new and r.platform_code = v_platform and date_trunc('month', r.period_start)::date = m
    group by r.period_key, r.period_end;
  end loop;

  select count(*) into v_rows from public.commerce_sales_rows where snapshot_id = v_new;
  select count(*) into v_sums from public.commerce_sales_summary_rows where snapshot_id = v_new;
  update public.commerce_sales_snapshots
  set row_count = v_rows, summary_row_count = v_sums,
      data_through = (select max(period_end) from public.commerce_sales_summary_rows where snapshot_id = v_new)
  where id = v_new;
  update public.commerce_sales_snapshots set is_current = false where is_current = true and id <> v_new;
  update public.commerce_sales_snapshots set is_current = true where id = v_new;

  return jsonb_build_object(
    'status','COMMITTED','version','v2','batch_id',p_batch_id,'snapshot_id',v_new,
    'rows',v_rows,'summary_rows',v_sums,'merged_parts',v_part_count,'multipart_group',v_group_key,
    'coverage',jsonb_build_object('start',v_start,'end',v_end,'final_through',v_final_through),
    'applied_days',(select count(*) from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and l.applied and l.has_sales),
    'days_without_sales',(select coalesce(jsonb_agg(l.sale_date order by l.sale_date), '[]'::jsonb)
        from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and l.applied and not l.has_sales),
    'kept_days',(select coalesce(jsonb_agg(jsonb_build_object('date', l.sale_date, 'reason', l.skip_reason) order by l.sale_date), '[]'::jsonb)
        from public.commerce_sales_day_coverage_v2 l where l.batch_id = any(v_group) and not l.applied),
    'rebuilt_months',(select coalesce(jsonb_agg(to_char(x, 'YYYY-MM') order by x), '[]'::jsonb) from unnest(v_months) x),
    'data_through',(select data_through from public.commerce_sales_snapshots where id = v_new));
end $fn$;
revoke all on function public.commerce_commit_sales_import_v2(bigint) from public, anon, authenticated;
grant execute on function public.commerce_commit_sales_import_v2(bigint) to service_role;

-- 8) Ativação financeira da Shopee compatível com a v2.
--    A view commerce_shopee_finance_current_month_v1 só mostra o financeiro do mês quando ele pertence ao snapshot
--    do último lote do mês. Na v2 o mês pode misturar dias de arquivos diferentes, e as taxas de pedidos com vários
--    SKUs só existem no total do mês do próprio arquivo. Por isso:
--      * o financeiro DIÁRIO (pedidos de 1 SKU) é gravado sempre, só dos dias que o lote realmente aplicou;
--      * o financeiro MENSAL só é publicado se TODOS os dias do mês pertencem a este arquivo (caso do arquivo
--        acumulado do mês ou do mês inteiro reexportado). Mês misturado fica sem financeiro mensal em vez de
--        mostrar um total que cobre só parte dos dias.
create or replace function public.commerce_activate_shopee_finance_v2(p_batch_id bigint)
returns jsonb language plpgsql security invoker set search_path=public as $fn$
declare v_snapshot bigint; v_batch_ids bigint[]; v_days integer; v_published date[]; v_skipped date[]; m record;
begin
  select snapshot_id into v_snapshot from public.commerce_sales_import_batches
  where id = p_batch_id and platform_code = 'SHOPEE' and status = 'COMMITTED';
  if v_snapshot is null then return jsonb_build_object('status','WAITING_COMMIT'); end if;
  perform pg_advisory_xact_lock(2026, 2987);
  select array_agg(id order by id) into v_batch_ids from public.commerce_sales_import_batches
  where platform_code = 'SHOPEE' and status = 'COMMITTED' and snapshot_id = v_snapshot;
  if not exists(select 1 from public.commerce_shopee_finance_stage_month_v1 where batch_id = any(v_batch_ids)) then
    return jsonb_build_object('status','FINANCE_NOT_IN_SOURCE','month_count',0);
  end if;
  v_published := array[]::date[]; v_skipped := array[]::date[];
  for m in select distinct f.month_start from public.commerce_shopee_finance_stage_month_v1 f where f.batch_id = any(v_batch_ids) order by 1 loop
    if exists(select 1 from public.commerce_sales_day_winners_v2('SHOPEE', m.month_start, (m.month_start + interval '1 month - 1 day')::date) w
              where w.batch_id <> all(v_batch_ids))
       or not exists(select 1 from public.commerce_sales_day_winners_v2('SHOPEE', m.month_start, (m.month_start + interval '1 month - 1 day')::date) w
              where w.batch_id = any(v_batch_ids)) then
      v_skipped := v_skipped || m.month_start;
      continue;
    end if;
    -- Mês inteiro deste arquivo: o financeiro precisa bater com as vendas do arquivo.
    if exists(
      with incoming as (
        select month_start, sum(units) units, round(sum(product_revenue), 2) revenue, sum(orders) orders
        from public.commerce_shopee_finance_stage_month_v1 where batch_id = any(v_batch_ids) and month_start = m.month_start group by month_start),
      own_sales as (
        select sum(r.units) units, round(sum(r.product_revenue), 2) revenue,
          (select count(*) from (select distinct o.sale_date, o.order_key from public.commerce_sales_import_stage_orders_v2 o
             where o.batch_id = any(v_batch_ids) and date_trunc('month', o.sale_date)::date = m.month_start) q) orders
        from public.commerce_sales_import_stage_rows r
        where r.batch_id = any(v_batch_ids) and date_trunc('month', r.period_start)::date = m.month_start)
      select 1 from incoming i cross join own_sales s
      where i.units <> s.units or abs(i.revenue - s.revenue) > 0.01 or i.orders <> s.orders) then
      raise exception 'Totais financeiros diferentes das vendas do arquivo. Revise as partes do relatório.';
    end if;
    if exists(
      with incoming as (
        select sum(units) units, sum(product_revenue) revenue, sum(unallocated_units) unallocated_units,
          sum(unallocated_revenue) unallocated_revenue, sum(single_sku_fee_orders) allocated_orders
        from public.commerce_shopee_finance_stage_month_v1 where batch_id = any(v_batch_ids) and month_start = m.month_start),
      alloc as (
        select sum(units) units, sum(product_revenue) revenue, sum(orders) orders
        from public.commerce_shopee_finance_stage_daily_v1
        where batch_id = any(v_batch_ids) and date_trunc('month', sale_date)::date = m.month_start)
      select 1 from incoming i cross join alloc a
      where coalesce(a.units, 0) + i.unallocated_units <> i.units
        or abs(coalesce(a.revenue, 0) + i.unallocated_revenue - i.revenue) > 0.01
        or coalesce(a.orders, 0) <> i.allocated_orders) then
      raise exception 'Atribuição financeira não reconcilia com os pedidos do arquivo.';
    end if;
    delete from public.commerce_shopee_finance_month_v1 where month_start = m.month_start;
    insert into public.commerce_shopee_finance_month_v1(month_start, source_snapshot_id, orders, units, product_revenue,
      seller_discount, commission_net, service_net, transaction_fee, fee_orders, single_sku_fee_orders,
      unallocated_orders, unallocated_units, unallocated_revenue)
    select month_start, v_snapshot, sum(orders)::integer, sum(units)::integer, round(sum(product_revenue), 2),
      round(sum(seller_discount), 2), round(sum(commission_net), 2), round(sum(service_net), 2), round(sum(transaction_fee), 2),
      sum(fee_orders)::integer, sum(single_sku_fee_orders)::integer, sum(unallocated_orders)::integer,
      sum(unallocated_units)::integer, round(sum(unallocated_revenue), 2)
    from public.commerce_shopee_finance_stage_month_v1
    where batch_id = any(v_batch_ids) and month_start = m.month_start group by month_start;
    v_published := v_published || m.month_start;
  end loop;
  -- Dias que o lote não aplicou já tiveram o financeiro removido do lote no commit; aqui só entram dias aplicados.
  insert into public.commerce_shopee_finance_daily_v1(sale_date, sku_norm, month_start, source_snapshot_id, orders, units,
    product_revenue, seller_discount, commission_net, service_net, transaction_fee)
  select sale_date, sku_norm, date_trunc('month', sale_date)::date, v_snapshot, sum(orders)::integer, sum(units)::integer,
    round(sum(product_revenue), 2), round(sum(seller_discount), 2), round(sum(commission_net), 2),
    round(sum(service_net), 2), round(sum(transaction_fee), 2)
  from public.commerce_shopee_finance_stage_daily_v1 where batch_id = any(v_batch_ids) group by sale_date, sku_norm
  on conflict (sale_date, sku_norm) do update set
    month_start = excluded.month_start, source_snapshot_id = excluded.source_snapshot_id, orders = excluded.orders,
    units = excluded.units, product_revenue = excluded.product_revenue, seller_discount = excluded.seller_discount,
    commission_net = excluded.commission_net, service_net = excluded.service_net, transaction_fee = excluded.transaction_fee;
  get diagnostics v_days = row_count;
  return jsonb_build_object('status','COMMITTED','version','v2','finance_days',v_days,
    'finance_months',coalesce(array_length(v_published,1),0),'finance_months_published',to_jsonb(v_published),
    'finance_months_mixed_not_published',to_jsonb(v_skipped),'source_snapshot_id',v_snapshot,'scope','single_sku_orders_only');
end $fn$;
revoke all on function public.commerce_activate_shopee_finance_v2(bigint) from public, anon, authenticated;
grant execute on function public.commerce_activate_shopee_finance_v2(bigint) to service_role;
