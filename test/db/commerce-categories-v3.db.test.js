// GA-P02A etapa 2 — commerce_categories_v3 (CANDIDATA, só neste Postgres local descartável) contra a v2 real, com dados FICTÍCIOS em volume de produção.
// Prova: o jsonb da v3 é IDÊNTICO (texto a texto) ao da v2 nas três contas e nos quatro períodos, mais modos/bordas; mede tempo, páginas e disco temporário.
// Rodar: npm run test:db. Medições completas: GA_P02A_REPORT=/caminho/relatorio.json npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer, newDb } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(here, p), 'utf8');
const GA021 = read('../../supabase/migrations/20261124150000_commerce_shopee_current_sku_source_v1.sql');
const GA011 = read('../../supabase/migrations/20261123200000_commerce_shopee_reconciliation_v1.sql');
const COLLECTION = (read('../../supabase/migrations/20261029250000_commerce_categories_collections_v1.sql').match(/create or replace function public\.commerce_collection_v1[\s\S]*?\$f\$;/i) || [])[0];
const CANDIDATE = read('fixtures/candidates/commerce_categories_v3.sql');

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

const DEPS = `
create table public.commerce_categories (id bigserial primary key, name text not null);
create table public.commerce_subcategories (id bigserial primary key, name text not null);
create table public.commerce_sku_category_v1 (sku_norm text primary key, category_id bigint, subcategory_id bigint);
create table public.commerce_sku_prefix_rules_v1 (prefix text primary key, category_id bigint, subcategory_id bigint);
create table public.commerce_sku_collection_v1 (sku_norm text primary key, collection text not null, note text);
create table public.commerce_marketplaces (id bigserial primary key, code text not null);
create table public.commerce_listings (id bigserial primary key, marketplace_id bigint, external_listing_id text, listing_status text,
  canonical_url text, source_url text, title text, account_code text);
create table public.commerce_listing_products (id bigserial primary key, listing_id bigint, platform_sku text, relation_status text, variation_name text);
create table public.commerce_products (id bigserial primary key, name text, reference_image_url text, category_id bigint);
create table public.commerce_product_skus (id bigserial primary key, product_id bigint, sku text);
alter table public.commerce_shopee_sku_owner_reviewed_v1 add column if not exists mapping_type text;
create table public.commerce_shopee_sales_history_reviews_v1 (source_sku_norm text, review_reason text, active boolean default true);
create table public.commerce_shopee_full_monthly_v1 (sale_month date, units integer, product_revenue numeric);
create index commerce_shopee_sku_daily_date_idx on public.commerce_shopee_sales_sku_daily_v1 (sale_date, sku_norm);
create index commerce_sales_rows_sku_canon_idx on public.commerce_sales_rows (upper(regexp_replace(coalesce(sku_norm, sku), '[\\s_]+', '', 'g')));
create index commerce_product_skus_canon_idx on public.commerce_product_skus (upper(regexp_replace(sku, '[\\s_]+', '', 'g')));
create or replace function public.commerce_sku_canon_v1(p_sku text) returns text language sql stable set search_path to 'public' as $$
  select coalesce((select a.new_sku from public.commerce_sku_alias_v1 a where a.old_sku=upper(regexp_replace(p_sku,'[\\s_]+','','g'))), upper(regexp_replace(p_sku,'[\\s_]+','','g')));
$$;
create or replace function public.commerce_sku_name_v1(p_sku text) returns text language sql stable set search_path to 'public' as $$
  select coalesce(
    (select pp.name from public.commerce_product_skus ps join public.commerce_products pp on pp.id=ps.product_id
       where upper(regexp_replace(ps.sku,'[\\s_]+','','g'))=p_sku limit 1),
    (select r.product_name from public.commerce_sales_rows r
       where upper(regexp_replace(coalesce(r.sku_norm,r.sku),'[\\s_]+','','g'))=p_sku and r.product_name is not null
       order by r.units desc, r.snapshot_id desc limit 1));
$$;
${COLLECTION}
create or replace function public.commerce_sku_col_v1(p_sku text, p_name text) returns text language sql stable set search_path to 'public' as $$
  select coalesce((select o.collection from public.commerce_sku_collection_v1 o where o.sku_norm=p_sku), public.commerce_collection_v1(p_name), 'Sem coleção');
$$;`;
const ALIAS_FIX = `drop table public.commerce_sku_alias_v1 cascade; create table public.commerce_sku_alias_v1 (old_sku text primary key, new_sku text not null);`;

// Dados FICTÍCIOS no volume de produção (≈ 40 mil linhas Shopee por SKU/dia, ≈ 2×9 mil de anúncios ML, ≈ 60 mil linhas de nomes).
// Vários snapshots que se sobrepõem (vence o mais novo de cada dia), SKUs com espaço/minúsculas/apelidos, categorias explícitas e por prefixo.
const SEED = `
insert into commerce_sales_snapshots(source_name,is_current) select 'S'||g, g=6 from generate_series(1,6) g;
-- SKUs: 365 canônicos 'K<m>-<nnn>'; variantes com espaço/minúscula; apelidos OLD-nnn.
create temp table sku_list as select n, 'K'||(n%80)||'-'||lpad(n::text,3,'0') sku from generate_series(1,365) n;
insert into commerce_categories(name) select 'Categoria '||g from generate_series(1,11) g;
insert into commerce_sku_prefix_rules_v1(prefix, category_id) select 'K'||m||'-', (m%11)+1 from generate_series(0,79) m;
insert into commerce_sku_category_v1(sku_norm, category_id) select sku, ((n+3)%11)+1 from sku_list where n%33=0;
insert into commerce_sku_collection_v1(sku_norm, collection) select sku, 'Coleção Especial '||(n%5) from sku_list where n%17=0;
insert into commerce_sku_alias_v1(old_sku,new_sku) select 'OLD-'||lpad(n::text,3,'0'), sku from sku_list where n<=15;
insert into commerce_products(name) select case when n%3=0 then 'Caderno Coleção Aurora '||n||' - Capa 1' when n%3=1 then 'Planner Linha Verde '||n||' - 2026' else 'Agenda Edição '||n end from sku_list where n<=300;
insert into commerce_product_skus(product_id, sku) select p.id, s.sku from sku_list s join commerce_products p on p.id=s.n where s.n<=300;
-- Shopee: 40 lotes antigos (11 dias, snapshots 1..3) + 22 lotes novos (20 dias, snapshots 4..6) que SOBREPÕEM os antigos.
create temp table sbatch as
  select i id_, date '2025-01-01'+(i-1)*11 d0, 11 len, 1+(i%3) snap from generate_series(1,40) i
  union all select 40+j, date '2026-01-01'+(j-1)*15, 20, 3+(j%3) from generate_series(1,22) j;
insert into commerce_sales_import_batches(id, platform_code, source_filename, status, snapshot_id, committed_at)
  select id_, 'SHOPEE', 'f'||id_||'.xlsx', 'COMMITTED', snap, now() from sbatch;
insert into commerce_sales_import_batches(id, platform_code, source_filename, status, snapshot_id)
  select 100+g, 'SHOPEE', 'aberto'||g||'.xlsx', case when g%2=0 then 'STAGED' else 'FAILED' end, 6 from generate_series(1,6) g;
insert into commerce_shopee_sales_sku_daily_v1(batch_id, sale_date, sku_norm, units, orders_with_item, product_revenue)
  select b.id_, (b.d0+k)::date, case when s.n%23=0 then lower(s.sku)||' ' when s.n<=15 and (b.id_+k)%9=0 then 'OLD-'||lpad(s.n::text,3,'0') else s.sku end,
         1+abs(hashtext(s.sku||(b.d0+k)::text))%20 + (b.snap-1), 1,
         round(((1+abs(hashtext(s.sku||(b.d0+k)::text))%20 + (b.snap-1)) * (5+abs(hashtext((b.d0+k)::text||s.sku))%40) + 0.37 + b.snap/7.0)::numeric, 4)
    from sbatch b cross join generate_series(0,19) k cross join sku_list s
   where k < b.len and abs(hashtext(s.sku||(b.d0+k)::text))%8=0
  on conflict do nothing;
-- ML: duas contas, 30 lotes de 13 dias (snapshots 1..3) + 22 lotes de 20 dias (snapshots 4..6) por conta, com resumo diário (period_start=period_end).
create temp table mbatch as
  select p.plat, p.base+i id_, date '2025-06-01'+(i-1)*13 d0, 13 len, 1+(i%3) snap from (values ('ML_ANTIGO',1000),('ML_NOVO',2000)) p(plat,base), generate_series(1,30) i
  union all select p.plat, p.base+100+j, date '2026-01-01'+(j-1)*15, 20, 3+(j%3) from (values ('ML_ANTIGO',1000),('ML_NOVO',2000)) p(plat,base), generate_series(1,22) j;
insert into commerce_sales_import_batches(id, platform_code, source_filename, status, snapshot_id, committed_at)
  select id_, plat, 'm'||id_||'.xlsx', 'COMMITTED', snap, now() from mbatch;
insert into commerce_sales_import_batches(id, platform_code, source_filename, status, snapshot_id)
  select 3000+g, case when g%2=0 then 'ML_ANTIGO' else 'ML_NOVO' end, 'mab'||g||'.xlsx', 'STAGED', 6 from generate_series(1,4) g;
insert into commerce_sales_import_stage_summary(batch_id, period_key, period_start, period_end, units, product_revenue)
  select b.id_, (b.d0+k)::text, b.d0+k, b.d0+k, 1, 1 from mbatch b cross join generate_series(0,19) k where k<b.len;
insert into commerce_sales_listing_daily_v1(batch_id, sale_date, external_listing_id, sku_norm, units, orders_with_item, product_revenue)
  select b.id_, (b.d0+k)::date, 'MLB'||b.plat||l, s.sku, 1+abs(hashtext(b.plat||l||(b.d0+k)::text))%9+(b.snap-1), 1,
         round((((1+abs(hashtext(b.plat||l||(b.d0+k)::text))%9+(b.snap-1)) * (7+abs(hashtext((b.d0+k)::text||l))%30)) + 0.55)::numeric, 2)
    from mbatch b cross join generate_series(0,19) k cross join generate_series(1,23) l
    join sku_list s on s.n = 1+abs(hashtext(b.plat||l||(b.d0+k)::text))%120
   where k<b.len on conflict do nothing;
-- nomes só em linhas de vendas antigas (a v2 e a v3 usam a mesma função de nome)
insert into commerce_sales_rows(snapshot_id, source_row_number, platform_code, period_key, period_start, period_end, sku, sku_norm, product_name, units)
  select 1+(g%6), g, 'SHOPEE', 'p', date '2025-01-01', date '2025-01-01', s.sku, s.sku, 'Produto '||s.sku||' - Variação '||(g%7), 1+(g%30)
    from generate_series(1,60000) g join sku_list s on s.n = 1+(g%365);
analyze;`;

async function mkDb() {
  const db = await newDb();
  await db.main.query(ALIAS_FIX); await db.main.query(DEPS); await db.main.query(GA011); await db.main.query(GA021); await db.main.query(CANDIDATE);
  await db.main.query(SEED);
  await db.main.query('vacuum analyze'); // como em produção (autovacuum): mapa de visibilidade ativo, index-only scan sem ler a tabela
  return db;
}
const CALLS = (fn) => {
  const list = [];
  for (const plat of ['SHOPEE', 'ML_ANTIGO', 'ML_NOVO']) for (const d of [7, 30, 60, 90]) list.push([`${plat} ${d}d`, `select public.${fn}('${plat}', null, 'days', null, ${d})::text j`]);
  return list;
};
const EDGES = [
  ['TODAS 30d', `'TODAS', null, 'days', null, 30`], ['TODAS ytd 2026', `'TODAS', 2026, 'ytd', null, null`], ['SHOPEE ytd 2026', `'SHOPEE', 2026, 'ytd', null, null`],
  ['SHOPEE ytd 2025', `'SHOPEE', 2025, 'ytd', null, null`], ['ML_NOVO ytd', `'ML_NOVO', null, 'ytd', null, null`], ['SHOPEE mês 11', `'SHOPEE', 2026, 'month', 11, null`],
  ['ML_ANTIGO mês 10', `'ML_ANTIGO', 2026, 'month', 10, null`], ['TODAS mês 3/2026', `'TODAS', 2026, 'month', 3, null`], ['mês inválido 13', `'SHOPEE', 2026, 'month', 13, null`],
  ['dias fora da faixa (100)', `'SHOPEE', null, 'days', null, 100`], ['dias 1', `'ML_NOVO', null, 'days', null, 1`], ['ano sem dados 2019', `'SHOPEE', 2019, 'ytd', null, null`],
  ['plataforma desconhecida', `'XYZ', null, 'days', null, 30`], ['plataforma minúscula', `'shopee', null, 'days', null, 30`], ['plataforma nula', `null, null, 'days', null, 30`],
  ['modo nulo', `'SHOPEE', 2026, null, null, null`], ['ano 2025 ML', `'ML_NOVO', 2025, 'days', null, 30`]
];

test('v3 devolve EXATAMENTE o mesmo jsonb da v2: 3 contas × 4 períodos, mais modos e bordas', async () => {
  const db = await mkDb();
  try {
    let compared = 0, nonEmpty = 0;
    for (const [label, sqlOld] of CALLS('commerce_categories_v2')) {
      const a = (await db.one(sqlOld)).j, b = (await db.one(sqlOld.replace('commerce_categories_v2', 'commerce_categories_v3'))).j;
      assert.equal(b, a, label); compared++;
      const o = JSON.parse(a); if (o.total.cur > 0 && o.categories.length > 0 && o.total.base > 0) nonEmpty++;
    }
    assert.equal(nonEmpty, 12, 'as 12 combinações têm dados no período atual e na base (o teste não é vazio)');
    for (const [label, args] of EDGES) {
      const a = (await db.one(`select public.commerce_categories_v2(${args})::text j`)).j, b = (await db.one(`select public.commerce_categories_v3(${args})::text j`)).j;
      assert.equal(b, a, label); compared++;
    }
    assert.equal(compared, 12 + EDGES.length);
  } finally { await db.close(); }
});

test('v3 preserva a escolha de lote/snapshot: snapshot mais novo vence por dia; lote aberto/falho nunca conta; contas ML não se misturam', async () => {
  const db = await mkDb();
  try {
    // 1) um dia com snapshots 1 e 4 sobrepostos: soma da v3 = soma do snapshot mais novo, igual à view da fonte única
    const day = (await db.one(`select max(sale_date)::text d from commerce_shopee_current_sku_daily_v1`)).d;
    const viaView = (await db.one(`select sum(units)::int u from commerce_shopee_current_sku_daily_v1 where sale_date between date '${day}'::date-6 and date '${day}'`)).u;
    const v3 = JSON.parse((await db.one(`select public.commerce_categories_v3('SHOPEE',null,'days',null,7)::text j`)).j);
    assert.equal(v3.total.cur, viaView);
    // 2) lote STAGED/FAILED com linhas enormes não altera nada
    const before = (await db.one(`select public.commerce_categories_v3('SHOPEE',null,'days',null,30)::text j`)).j;
    await db.q(`insert into commerce_shopee_sales_sku_daily_v1(batch_id,sale_date,sku_norm,units,orders_with_item,product_revenue) values (101, date '${day}', 'K1-001', 9999, 1, 99999)`);
    await db.q(`insert into commerce_sales_listing_daily_v1(batch_id,sale_date,external_listing_id,sku_norm,units,orders_with_item,product_revenue) values (3001, date '${day}', 'X', 'K1-001', 9999, 1, 99999)`);
    await db.q(`insert into commerce_sales_import_stage_summary(batch_id,period_key,period_start,period_end) values (3001, '${day}', date '${day}', date '${day}')`);
    assert.equal((await db.one(`select public.commerce_categories_v3('SHOPEE',null,'days',null,30)::text j`)).j, before);
    assert.equal((await db.one(`select public.commerce_categories_v3('SHOPEE',null,'days',null,30)::text j`)).j, (await db.one(`select public.commerce_categories_v2('SHOPEE',null,'days',null,30)::text j`)).j);
    // 2b) o mesmo para ML: o lote 3001 (STAGED, ML_NOVO) tem linhas + resumo diário, mas NÃO pode contar em nenhuma visão
    for (const pl of ['ML_NOVO', 'TODAS']) {
      const q = `select public.commerce_categories_%s('${pl}',null,'days',null,30)::text j`;
      assert.equal((await db.one(q.replace('%s', 'v3'))).j, (await db.one(q.replace('%s', 'v2'))).j, 'ML aberto: v3 = v2 em ' + pl);
    }
    const semAberto = (await db.one(`select public.commerce_categories_v3('ML_NOVO',null,'days',null,30)::text j`)).j;
    await db.q(`delete from commerce_sales_listing_daily_v1 where batch_id=3001`); await db.q(`delete from commerce_sales_import_stage_summary where batch_id=3001`);
    assert.equal((await db.one(`select public.commerce_categories_v3('ML_NOVO',null,'days',null,30)::text j`)).j, semAberto, 'lote ML STAGED não pode alterar o resultado');
    // 3) ML_ANTIGO e ML_NOVO: totais diferentes entre si e iguais à v2
    const a = JSON.parse((await db.one(`select public.commerce_categories_v3('ML_ANTIGO',null,'days',null,30)::text j`)).j), n = JSON.parse((await db.one(`select public.commerce_categories_v3('ML_NOVO',null,'days',null,30)::text j`)).j);
    assert.notEqual(a.total.cur, n.total.cur); assert.equal(a.platform, 'ML_ANTIGO'); assert.equal(n.platform, 'ML_NOVO');
  } finally { await db.close(); }
});

test('v3 trata dados ausentes como a v2 (conta sem vendas, ano sem dados, período sem base)', async () => {
  const db = await newDb();
  try {
    await db.main.query(ALIAS_FIX); await db.main.query(DEPS); await db.main.query(GA011); await db.main.query(GA021); await db.main.query(CANDIDATE);
    for (const args of [`'SHOPEE', null, 'days', null, 30`, `'ML_NOVO', 2026, 'ytd', null, null`, `'TODAS', null, 'month', 5, null`]) {
      const a = (await db.one(`select public.commerce_categories_v2(${args})::text j`)).j, b = (await db.one(`select public.commerce_categories_v3(${args})::text j`)).j;
      assert.equal(b, a, 'banco vazio: ' + args);
    }
  } finally { await db.close(); }
});

// ---- medição (tempo, páginas, disco temporário) e simulação de 1/2/3 execuções simultâneas; só roda com GA_P02A_REPORT ----
const REPORT = process.env.GA_P02A_REPORT;
const planOf = async (c, sql) => {
  const r = await c.query(`explain (analyze, buffers, format json) ${sql}`);
  const p = r.rows[0]['QUERY PLAN'][0];
  const n = p.Plan;
  return { ms: p['Execution Time'], hit: n['Shared Hit Blocks'], read: n['Shared Read Blocks'], tmpR: n['Temp Read Blocks'], tmpW: n['Temp Written Blocks'] };
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
test('medição local v2 x v3 e concorrência 1/2/3', { skip: !REPORT }, async () => {
  const db = await mkDb();
  const out = { volumes: {}, tempos: [], concorrencia: [] };
  try {
    for (const t of ['commerce_shopee_sales_sku_daily_v1', 'commerce_sales_listing_daily_v1', 'commerce_sales_rows', 'commerce_sales_import_batches'])
      out.volumes[t] = Number((await db.one(`select count(*)::int c from ${t}`)).c);
    const c = db.main;
    for (const [label, sqlOld] of CALLS('commerce_categories_v2')) {
      const row = { label };
      for (const [k, sql] of [['v2', sqlOld], ['v3', sqlOld.replace('commerce_categories_v2', 'commerce_categories_v3')]]) {
        await planOf(c, sql); // aquece
        const runs = []; for (let i = 0; i < 5; i++) runs.push(await planOf(c, sql));
        const med = runs.sort((x, y) => x.ms - y.ms)[2];
        row[k] = { ms: Math.round(med.ms), pages: med.hit + med.read, tmp_blocks: (med.tmpR || 0) + (med.tmpW || 0) };
      }
      out.tempos.push(row);
    }
    // concorrência: N clientes ao mesmo tempo, mesma consulta; mede o tempo de parede de cada um (mediana de 3 rodadas)
    for (const fn of ['commerce_categories_v2', 'commerce_categories_v3'])
      for (const n of [1, 2, 3]) {
        const rounds = [];
        for (let r = 0; r < 3; r++) {
          const clients = []; for (let i = 0; i < n; i++) clients.push(await db.client());
          const t = await Promise.all(clients.map(async (cl) => { const t0 = performance.now(); await cl.query(`select public.${fn}('SHOPEE', null, 'days', null, 30)`); return performance.now() - t0; }));
          rounds.push(Math.max(...t));
        }
        out.concorrencia.push({ fn, simultaneas: n, pior_ms: Math.round(median(rounds)) });
      }
    if (process.env.GA_P02A_PLAN) { // GA_P02A_PLAN="ML_ANTIGO:90": despeja o plano do CORPO da v3 (parâmetros trocados por literais)
      const [pl, d] = process.env.GA_P02A_PLAN.split(':'); out.planos = {};
      const body = CANDIDATE.split('$function$')[1].replace(/\bp_platform\b/g, `'${pl}'::text`).replace(/\bp_year\b/g, 'null::integer')
        .replace(/\bp_mode\b/g, `'days'::text`).replace(/\bp_month\b/g, 'null::integer').replace(/\bp_days\b/g, `${d}::integer`);
      out.planos.v3 = (await c.query(`explain (analyze, buffers) ${body}`)).rows.map((r) => r['QUERY PLAN']);
    }
    fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
  } finally { await db.close(); }
});
