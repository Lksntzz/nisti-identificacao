// GA-021 — fonte única de vendas da Shopee por SKU, num Postgres 17 local descartável, só com dados FICTÍCIOS.
// Prova que as dez funções que liam a tabela legada crua passam a usar a mesma regra de seleção da GA-019
// (lote COMMITTED; snapshot mais novo por dia; partes do mesmo snapshot somam; SKU sem vínculo preservado).
// Rodar: npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer, newDb, stage, commit } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(here, '../../supabase/migrations/20261124150000_commerce_shopee_current_sku_source_v1.sql');
const MIGRATION_SQL = fs.readFileSync(MIGRATION, 'utf8');
const GA011 = fs.readFileSync(path.join(here, '../../supabase/migrations/20261123200000_commerce_shopee_reconciliation_v1.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(here, '../../docs/reversao/GA-021-reversao.sql'), 'utf8');
const NEW_SRC = 'commerce_shopee_current_sku_daily_v1';
const OLD_SRC = 'commerce_shopee_sales_sku_daily_v1';

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

// Tabelas/funções de apoio que as dez funções leem e que o esquema mínimo do harness não tem.
// commerce_sku_canon_v1 e commerce_sku_name_v1 são as definições reais de produção; a coleção é simplificada
// (só a tabela de exceções), porque o teste é sobre a FONTE das vendas, não sobre a heurística de coleção.
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
create or replace function public.commerce_sku_col_v1(p_sku text, p_name text) returns text language sql stable set search_path to 'public' as $$
  select coalesce((select c.collection from public.commerce_sku_collection_v1 c where c.sku_norm=p_sku), 'Sem coleção');
$$;
`;

// A tabela de apelidos do harness tem só a coluna "alias"; as funções reais usam old_sku/new_sku.
const ALIAS_FIX = `drop table public.commerce_sku_alias_v1 cascade;
create table public.commerce_sku_alias_v1 (old_sku text primary key, new_sku text not null);`;

async function mkBatch(db, { status = 'COMMITTED', snap = null, platform = 'SHOPEE' }) {
  return (await db.one(
    `insert into commerce_sales_import_batches(platform_code, source_filename, status, snapshot_id, committed_at)
     values ($1,'ga021.xlsx',$2,$3, case when $2='COMMITTED' then now() end) returning id`, [platform, status, snap])).id;
}
async function legacy(db, batch, date, sku, units) {
  await db.q(`insert into commerce_shopee_sales_sku_daily_v1(batch_id, sale_date, sku_norm, units, orders_with_item, product_revenue)
    values ($1,$2,$3,$4,$4,$5)`, [batch, date, sku, units, units * 10]);
}

// Estado fictício. Dias (como a GA-019 enxerga): 15/09=20, 20/10=10, 01/11=8, 02/11=8 (versão nova, 6+2), 2025: 01/11=9, 02/11=3.
async function seed(db) {
  const snap1 = (await db.one(`insert into commerce_sales_snapshots(source_name, is_current) values ('S1', false) returning id`)).id;
  const snap2 = (await db.one(`insert into commerce_sales_snapshots(source_name, is_current) values ('S2', true) returning id`)).id;
  const p1 = await mkBatch(db, { snap: snap1 });
  const p2 = await mkBatch(db, { snap: snap1 }); // outra parte do MESMO snapshot (importação em várias partes)
  const b2 = await mkBatch(db, { snap: snap2 }); // versão mais nova que substitui só o dia 02/11
  for (const [d, s, u] of [['2026-09-15', 'AAA-1', 20], ['2026-10-20', 'AAA-1', 10], ['2026-11-01', 'AAA-1', 5],
    ['2026-11-02', 'AAA-1', 4] /* versão antiga, substituída */, ['2025-11-01', 'AAA-1', 9], ['2025-11-02', 'AAA-1', 3]]) await legacy(db, p1, d, s, u);
  await legacy(db, p2, '2026-11-01', 'BBB-1', 3);
  await legacy(db, b2, '2026-11-02', 'AAA-1', 6);
  await legacy(db, b2, '2026-11-02', 'ZZZ-9', 2); // SKU sem vínculo com anúncio
  // Lotes que NÃO podem contar: dois abertos idênticos (duplicados) e um falho. Têm linhas na tabela legada, como em produção.
  for (const status of ['STAGED', 'STAGED', 'FAILED']) {
    const b = await mkBatch(db, { status });
    const rows = status === 'FAILED' ? [['2026-11-03', 'AAA-1', 77]]
      : [['2026-11-02', 'AAA-1', 100], ['2026-11-05', 'AAA-1', 50], ['2026-10-20', 'AAA-1', 100], ['2026-09-15', 'AAA-1', 100]];
    for (const [d, s, u] of rows) await legacy(db, b, d, s, u);
  }
  // Vínculo com anúncio: só AAA-1 e BBB-1 têm dono revisado; ZZZ-9 fica sem vínculo.
  await db.q(`insert into commerce_shopee_sku_owner_reviewed_v1(source_sku_norm, canonical_sku_norm, external_listing_id)
    values ('AAA-1','AAA-1','L-A'),('BBB-1','BBB-1','L-B')`);
  // Categorias por prefixo (fictícias) e uma linha de frete "Full" no mês de novembro.
  await db.q(`insert into commerce_categories(name) values ('Cat A'),('Cat B')`);
  await db.q(`insert into commerce_sku_prefix_rules_v1(prefix, category_id) select 'AAA', id from commerce_categories where name='Cat A'`);
  await db.q(`insert into commerce_sku_prefix_rules_v1(prefix, category_id) select 'BBB', id from commerce_categories where name='Cat B'`);
  await db.q(`insert into commerce_shopee_full_daily_v1(batch_id, sale_date, sku_norm, units, product_revenue) values ($1,'2026-11-01','AAA-1',1,10)`, [p1]);
  return { snap1, snap2, p1, p2, b2 };
}

async function install(db, sql = MIGRATION_SQL) {
  await db.main.query(ALIAS_FIX);
  await db.main.query(DEPS);
  await db.main.query(GA011); // conciliação GA-011 REAL: a divisão total x vinculada a reaproveita
  await db.main.query(sql);
}

function withDb(name, fn, { seeded = true } = {}) {
  test(name, async () => {
    const db = await newDb();
    try {
      await install(db);
      if (seeded) await seed(db);
      await fn(db);
    } finally { await db.close(); }
  });
}

// Uma sonda por função: consulta + valor esperado com a regra correta (dados fictícios acima).
const PROBES = [
  { fn: 'commerce_period_v1', sql: `select as_of::text v from public.commerce_period_v1('SHOPEE',2026,'ytd',null,null)`, expect: '2026-11-02' },
  { fn: 'commerce_categories_v2', sql: `select (public.commerce_categories_v2('SHOPEE',2026,'ytd',null,null)->'total'->>'cur')::int v`, expect: 46 },
  { fn: 'commerce_categories_sub_v2', sql: `select (public.commerce_categories_sub_v2('SHOPEE',2026,'ytd',null,null,'Cat A','Sem subcategoria')->'up'->0->>'cur')::int v`, expect: 41 },
  { fn: 'commerce_categories_col_v2', sql: `select (public.commerce_categories_col_v2('SHOPEE',2026,'ytd',null,null,'Cat A','Sem coleção')->'items'->0->>'cur')::int v`, expect: 41 },
  { fn: 'commerce_categories_timeline_v1',
    sql: `select (jsonb_path_query_first(public.commerce_categories_timeline_v1('SHOPEE',2026,'Cat A',11,null,null)->'category_months','$[*] ? (@.cat=="Cat A" && @.year==2026 && @.month==11).units'))::int v`, expect: 11 },
  { fn: 'commerce_dashboard_abc_v2', sql: `select (select sum((c->>'units')::numeric)::int from jsonb_array_elements(public.commerce_dashboard_abc_v2('SHOPEE','2026-01-01','2026-12-31')->'classes') c) v`, expect: 46 },
  { fn: 'commerce_annual_compare_coverage_v1',
    sql: `select (select (x->>'units')::int from jsonb_array_elements(public.commerce_annual_compare_coverage_v1()) x where x->>'platform'='SHOPEE' and (x->>'year')::int=2026) v`, expect: 46 },
  { fn: 'commerce_annual_compare_v1', sql: `select (public.commerce_annual_compare_v1('SHOPEE','month',2026,2025)->'kpi'->>'cur')::int v`, expect: 46 },
  { fn: 'commerce_sku_prior_map_v1', sql: `select (public.commerce_sku_prior_map_v1('SHOPEE',2026)->>'AAA-1')::int v`, expect: 41 },
  { fn: 'commerce_dashboard_shipping_split_v1', sql: `select (public.commerce_dashboard_shipping_split_v1('2026-11-01','2026-11-03')->>'total_units')::int v`, expect: 16 }
];

withDb('a fonte única usa só lote COMMITTED, a versão mais nova de cada dia e soma as partes do mesmo snapshot', async (db) => {
  const rows = await db.q(`select sale_date::text d, sku_norm sku, units from public.commerce_shopee_current_sku_daily_v1 order by 1,2`);
  assert.deepEqual(rows.map((r) => [r.d, r.sku, r.units]), [
    ['2025-11-01', 'AAA-1', 9], ['2025-11-02', 'AAA-1', 3],
    ['2026-09-15', 'AAA-1', 20], ['2026-10-20', 'AAA-1', 10],
    ['2026-11-01', 'AAA-1', 5], ['2026-11-01', 'BBB-1', 3], // importação em duas partes: somam no dia
    ['2026-11-02', 'AAA-1', 6], ['2026-11-02', 'ZZZ-9', 2]  // versão nova substitui a antiga (4); abertos e falho ficam de fora
  ]);
});

withDb('defeito reproduzido: a tabela legada crua tem mais unidades que a fonte válida (lotes abertos e versão antiga)', async (db) => {
  const r = await db.one(`select (select sum(units) from commerce_shopee_sales_sku_daily_v1 where sale_date>='2026-01-01')::int raw,
    (select sum(units) from commerce_shopee_current_sku_daily_v1 where sale_date>='2026-01-01')::int valid`);
  assert.equal(r.valid, 46);
  assert.equal(r.raw, 46 + 4 /* versão substituída */ + 2 * (100 + 50 + 100 + 100) /* dois abertos iguais */ + 77 /* falho */);
});

withDb('mesma regra da GA-019: total por dia da fonte única = commerce_sales_daily_source_v2', async (db) => {
  const a = await db.q(`select sale_date::text d, sum(units)::int u from commerce_shopee_current_sku_daily_v1 group by 1 order by 1`);
  const b = await db.q(`select sale_date::text d, units::int u from public.commerce_sales_daily_source_v2('SHOPEE','2000-01-01','2100-01-01') order by 1`);
  assert.deepEqual(a, b);
});

withDb('cada função devolve o valor da fonte válida (nenhum aberto, falho, duplicado ou versão antiga entra)', async (db) => {
  for (const p of PROBES) assert.equal((await db.one(p.sql)).v, p.expect, p.fn);
});

withDb('7, 30, 90 dias e ano: mesmas datas e mesma contagem nas categorias, na curva ABC e na fonte da GA-019', async (db) => {
  const esperado = { 7: [16, 12], 30: [26, 12], 90: [46, 12] };
  for (const n of [7, 30, 90]) {
    const c = await db.one(`select public.commerce_categories_v2('SHOPEE',2026,'days',null,$1) j`, [n]);
    const j = c.j;
    assert.equal(j.as_of, '2026-11-02', 'a data de referência vem só de lote válido');
    assert.equal(j.total.cur, esperado[n][0], `${n} dias: atual`);
    assert.equal(j.total.base, esperado[n][1], `${n} dias: ano anterior, mesmas datas`);
    const ds = await db.one(`select (select sum(units) from public.commerce_sales_daily_source_v2('SHOPEE',$1::date,$2::date))::int cur,
      (select sum(units) from public.commerce_sales_daily_source_v2('SHOPEE',$3::date,$4::date))::int base`, [j.cur_from, j.cur_to, j.base_from, j.base_to]);
    assert.equal(ds.cur, j.total.cur, `${n} dias: categorias = fonte diária da GA-019`);
    assert.equal(ds.base, j.total.base);
    const abc = await db.one(`select (select sum((c->>'units')::numeric)::int from jsonb_array_elements(public.commerce_dashboard_abc_v2('SHOPEE',$1::date,$2::date)->'classes') c) u`, [j.cur_from, j.cur_to]);
    assert.equal(abc.u, esperado[n][0], `${n} dias: curva ABC`);
  }
  const y = (await db.one(`select public.commerce_categories_v2('SHOPEE',2026,'ytd',null,null) j`)).j;
  assert.equal(y.total.cur, 46); assert.equal(y.total.base, 12);
  const cov = (await db.one(`select public.commerce_annual_compare_coverage_v1() j`)).j.filter((x) => x.platform === 'SHOPEE');
  assert.deepEqual(cov.map((x) => [x.year, x.units, x.days]), [[2025, 12, 2], [2026, 46, 4]]);
  const ac = (await db.one(`select public.commerce_annual_compare_v1('SHOPEE','month',2026,2025) j`)).j;
  assert.equal(ac.kpi.cur, 46); assert.equal(ac.kpi.base, 12);
});

withDb('SKU sem vínculo é preservado nas categorias e na curva ABC; total, vinculada e sem vínculo não duplicam unidades', async (db) => {
  const abc = (await db.one(`select public.commerce_dashboard_abc_v2('SHOPEE','2026-01-01','2026-12-31') j`)).j;
  const z = abc.items.find((i) => i.key === 'ZZZ-9');
  assert.ok(z, 'ZZZ-9 (sem vínculo) continua na curva ABC');
  assert.equal(z.units, 2);
  const cat = (await db.one(`select public.commerce_categories_v2('SHOPEE',2026,'ytd',null,null) j`)).j;
  assert.ok(cat.categories.some((c) => c.name === 'Sem categoria' && c.cur === 2), 'sem categoria, mas conta');
  const s = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2026-11-01','2026-11-02') j`)).j;
  assert.equal(s.total_units, 16); assert.equal(s.linked_units, 14); assert.equal(s.unlinked_units, 2);
  assert.equal(s.total_units, s.linked_units + s.unlinked_units);
  assert.equal(s.unlinked_sku_count, 1);
  const all = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2025-01-01','2026-12-31') j`)).j;
  assert.equal(all.total_units, 58); assert.equal(all.linked_units, 56); assert.equal(all.unlinked_units, 2);
});

withDb('divergência NEGATIVA explicada: base menor que o total por causa de SKU sem vínculo, sem resíduo', async (db) => {
  const s = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2026-11-01','2026-11-02') j`)).j;
  assert.equal(s.status, 'COMPLETO');
  assert.equal(s.base_units, 14);
  assert.deepEqual(s.difference, { units: -2, direction: 'NEGATIVA', unlinked_effect_units: -2, other_explained_units: 0, residual_units: 0, explained: true });
  assert.equal(s.reconciliation.status, 'EXPLICADA');
  assert.equal(s.reconciliation.identity_ok, true);
  assert.equal(s.reconciliation.source_units_match, true);
});

withDb('divergência POSITIVA explicada por outra causa (dia com linhas nativas por anúncio): não vira "sem vínculo"', async (db) => {
  // 01/11 passa a ter linhas nativas por anúncio na Shopee (20 un.), maiores que a fonte por SKU do dia (8 un.).
  const b = await mkBatch(db, { snap: 99 });
  await db.q(`insert into commerce_sales_import_stage_summary(batch_id, period_key, period_start, period_end, net_orders, units, product_revenue)
    values ($1,'2026-11-01','2026-11-01','2026-11-01',1,20,200)`, [b]);
  await db.q(`insert into commerce_sales_listing_daily_v1(batch_id, sale_date, external_listing_id, sku_norm, units, orders_with_item, product_revenue)
    values ($1,'2026-11-01','L-A','AAA-1',20,1,200)`, [b]);
  const s = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2026-11-01','2026-11-02') j`)).j;
  assert.equal(s.total_units, 16);
  assert.equal(s.base_units, 26);
  assert.equal(s.difference.units, 10);
  assert.equal(s.difference.direction, 'POSITIVA');
  assert.equal(s.difference.unlinked_effect_units, -2, 'só o SKU realmente sem vínculo (02/11)');
  assert.equal(s.difference.other_explained_units, 12, 'o excesso de 01/11 é outra causa, não sem vínculo');
  assert.equal(s.difference.residual_units, 0);
  assert.equal(s.difference.explained, true);
  assert.equal(s.reconciliation.status, 'EXPLICADA');
  assert.equal(s.unlinked_units, 2, 'sem vínculo não absorve a diferença positiva');
});

withDb('resíduo não explicado aparece separado (conciliação GA-011 com divergência) e nunca é jogado em "sem vínculo"', async (db) => {
  // Contrato: se a GA-011 devolver resíduo, a divisão preserva o resíduo e marca RESIDUO_NAO_EXPLICADO.
  await db.main.query('drop function public.commerce_shopee_reconciliation_v1(date, date, integer)');
  await db.main.query(`create function public.commerce_shopee_reconciliation_v1(p_start date, p_end date, p_limit integer)
    returns jsonb language sql stable as $$ select jsonb_build_object('status','COMPLETO',
      'totals', jsonb_build_object('source', jsonb_build_object('units',16), 'base', jsonb_build_object('units',19)),
      'difference', jsonb_build_object('units',3,'unmatched_effect_units',-2,'native_days_effect_units',0,'residual_units',5,'explained',false),
      'reconciled_pct', jsonb_build_object('matched_units',14,'unmatched_units',2),
      'unmatched_skus', jsonb_build_array(jsonb_build_object('sku_norm','ZZZ-9')),
      'coverage', jsonb_build_object('source_missing_days',0,'missing_ranges','[]'::jsonb,'source_days_with_data',2)) $$`);
  const s = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2026-11-01','2026-11-02') j`)).j;
  assert.equal(s.difference.residual_units, 5);
  assert.equal(s.difference.unlinked_effect_units, -2);
  assert.equal(s.difference.explained, false);
  assert.equal(s.reconciliation.status, 'RESIDUO_NAO_EXPLICADO');
  assert.equal(s.unlinked_units, 2);
});

withDb('conciliação inconsistente (fonte da GA-011 diferente da fonte única) é sinalizada, não escondida', async (db) => {
  await db.main.query('drop function public.commerce_shopee_reconciliation_v1(date, date, integer)');
  await db.main.query(`create function public.commerce_shopee_reconciliation_v1(p_start date, p_end date, p_limit integer)
    returns jsonb language sql stable as $$ select jsonb_build_object('status','COMPLETO',
      'totals', jsonb_build_object('source', jsonb_build_object('units',17), 'base', jsonb_build_object('units',14)),
      'difference', jsonb_build_object('units',-3,'unmatched_effect_units',-2,'native_days_effect_units',0,'residual_units',-1,'explained',false),
      'reconciled_pct', jsonb_build_object('matched_units',14,'unmatched_units',3),
      'unmatched_skus', '[]'::jsonb,
      'coverage', jsonb_build_object('source_missing_days',0,'missing_ranges','[]'::jsonb,'source_days_with_data',2)) $$`);
  const s = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2026-11-01','2026-11-02') j`)).j;
  assert.equal(s.reconciliation.status, 'INCONSISTENTE');
  assert.equal(s.reconciliation.source_units_match, false);
});

withDb('período com dia ausente é PARCIAL e lista o dia sem informação; período sem nenhuma venda é SEM_INFORMACAO com números nulos', async (db) => {
  const parcial = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2026-10-31','2026-11-02') j`)).j;
  assert.equal(parcial.status, 'PARCIAL');
  assert.equal(parcial.coverage.missing_days, 1);
  assert.deepEqual(parcial.coverage.missing_ranges.map((x) => [x.start, x.end, x.days]), [['2026-10-31', '2026-10-31', 1]]);
  assert.equal(parcial.total_units, 16, 'o dia ausente não vira zero nem muda o total');
  const vazio = (await db.one(`select public.commerce_shopee_sales_link_split_v1('2026-12-01','2026-12-10') j`)).j;
  assert.equal(vazio.status, 'SEM_INFORMACAO');
  for (const k of ['total_units', 'linked_units', 'unlinked_units', 'base_units', 'difference']) assert.equal(vazio[k], null, `${k} não pode ser zero`);
  assert.equal(vazio.reconciliation.status, 'SEM_INFORMACAO');
  assert.equal(vazio.coverage.days_with_data, 0);
  assert.match(vazio.note, /ausência de informação, não zero/);
});

withDb('a divisão total x vinculada recusa período inválido', async (db) => {
  await assert.rejects(db.one(`select public.commerce_shopee_sales_link_split_v1(null,'2026-11-02')`), /periodo invalido/);
  await assert.rejects(db.one(`select public.commerce_shopee_sales_link_split_v1('2026-11-03','2026-11-02')`), /periodo invalido/);
  await assert.rejects(db.one(`select public.commerce_shopee_sales_link_split_v1('2020-01-01','2026-11-02')`), /1100 dias/);
});

withDb('Mercado Livre não muda: a fonte continua a view da GA-019 e a Shopee não é afetada', async (db) => {
  const id = await stage(db, { platform: 'ML_NOVO', file: 'ml.xlsx', created: '2026-11-03T12:00:00-03:00',
    days: { '2026-11-02': [{ sku: 'AAA-1', units: 7, rev: 70, orders: ['m1'] }] } });
  await commit(db, id);
  const ml = (await db.one(`select public.commerce_categories_v2('ML_NOVO',2026,'ytd',null,null) j`)).j;
  assert.equal(ml.total.cur, 7);
  const sp = (await db.one(`select public.commerce_categories_v2('SHOPEE',2026,'ytd',null,null) j`)).j;
  assert.equal(sp.total.cur, 46);
  const all = (await db.one(`select public.commerce_categories_v2('TODAS',2026,'ytd',null,null) j`)).j;
  assert.equal(all.total.cur, 53);
  assert.equal((await db.one(`select (public.commerce_annual_compare_coverage_v1()) j`)).j.find((x) => x.platform === 'ML_NOVO' && x.year === 2026).units, 7);
});

withDb('permissões: fonte e função novas só para service_role', async (db) => {
  const p = await db.one(`select has_table_privilege('anon','public.commerce_shopee_current_sku_daily_v1','select') a,
    has_table_privilege('authenticated','public.commerce_shopee_current_sku_daily_v1','select') u,
    has_table_privilege('service_role','public.commerce_shopee_current_sku_daily_v1','select') s,
    has_function_privilege('anon','public.commerce_shopee_sales_link_split_v1(date,date)','execute') fa,
    has_function_privilege('authenticated','public.commerce_shopee_sales_link_split_v1(date,date)','execute') fu,
    has_function_privilege('service_role','public.commerce_shopee_sales_link_split_v1(date,date)','execute') fs`);
  assert.deepEqual([p.a, p.u, p.s, p.fa, p.fu, p.fs], [false, false, true, false, false, true]);
});

withDb('a migração pode ser aplicada duas vezes e não altera lotes nem dados históricos', async (db) => {
  const antes = await db.one(`select (select count(*) from commerce_shopee_sales_sku_daily_v1)::int l, (select count(*) from commerce_sales_import_batches)::int b,
    (select string_agg(status||':'||count, ',' order by status) from (select status, count(*) from commerce_sales_import_batches group by 1) x) s`);
  await db.main.query(MIGRATION_SQL);
  const depois = await db.one(`select (select count(*) from commerce_shopee_sales_sku_daily_v1)::int l, (select count(*) from commerce_sales_import_batches)::int b,
    (select string_agg(status||':'||count, ',' order by status) from (select status, count(*) from commerce_sales_import_batches group by 1) x) s`);
  assert.deepEqual(depois, antes);
  assert.match(antes.s, /STAGED:2/, 'os dois lotes abertos continuam abertos');
});

test('o cache afetado é invalidado e o restante é preservado', async () => {
  const db = await newDb();
  try {
    await db.main.query(ALIAS_FIX); await db.main.query(DEPS);
    await db.q(`insert into commerce_read_cache_v1(cache_key, data_version, payload) values
      ('commerce_dashboard_abc_v2|{"p_platform":"SHOPEE"}','v','{}'),('commerce_categories_v2|{}','v','{}'),
      ('commerce_categories_timeline_v1|{}','v','{}'),('commerce_dashboard_shipping_split_v1|{}','v','{}'),
      ('commerce_dashboard_v1|{}','v','{}'),('commerce_dashboard_overview_v1|{}','v','{}')`);
    await db.main.query(MIGRATION_SQL);
    const left = (await db.q('select cache_key k from commerce_read_cache_v1 order by 1')).map((r) => r.k);
    assert.deepEqual(left, ['commerce_dashboard_overview_v1|{}', 'commerce_dashboard_v1|{}']);
  } finally { await db.close(); }
});

withDb('reversão: devolve as dez funções à leitura crua sem tocar em dados, e reaplicar a migração conserta de novo', async (db) => {
  const dados = () => db.one(`select (select count(*) from commerce_shopee_sales_sku_daily_v1)::int l, (select count(*) from commerce_sales_import_batches)::int b,
    (select sum(units) from commerce_shopee_sales_sku_daily_v1)::int u`);
  const antes = await dados();
  await db.main.query(ROLLBACK);
  assert.deepEqual(await dados(), antes, 'a reversão não mexe em nenhuma venda nem lote');
  const defs = await db.q(`select proname, pg_get_functiondef(oid) d from pg_proc where pronamespace='public'::regnamespace and proname = any($1)`, [PROBES.map((p) => p.fn)]);
  assert.equal(defs.length, 10);
  for (const x of defs) { assert.ok(x.d.includes(OLD_SRC), x.proname); assert.ok(!x.d.includes(NEW_SRC), x.proname); }
  for (const p of PROBES) assert.notEqual((await db.one(p.sql)).v, p.expect, `${p.fn}: revertida volta ao valor da tabela crua`);
  await db.main.query(MIGRATION_SQL);
  for (const p of PROBES) assert.equal((await db.one(p.sql)).v, p.expect, `${p.fn}: reaplicada volta ao valor correto`);
});

// Guarda de sensibilidade: se qualquer uma das dez funções voltasse a ler a tabela legada crua, o teste correspondente tem que falhar.
function mutate(sql, fn) {
  const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(.*?\\$function\\$.*?\\$function\\$`, 's');
  const m = re.exec(sql);
  assert.ok(m, `função ${fn} não encontrada na migração`);
  assert.ok(m[0].includes(NEW_SRC), `${fn} deveria usar a fonte única`);
  return sql.replace(m[0], m[0].split(NEW_SRC).join(OLD_SRC));
}

for (const p of PROBES) {
  test(`mutação: se ${p.fn} voltar a ler a tabela legada crua, a sonda detecta`, async () => {
    const db = await newDb();
    try {
      await install(db, mutate(MIGRATION_SQL, p.fn));
      await seed(db);
      const v = (await db.one(p.sql)).v;
      assert.notEqual(v, p.expect, `${p.fn}: com a leitura crua o valor deveria divergir do correto`);
    } finally { await db.close(); }
  });
}

test('nenhuma das dez funções da migração cita a tabela legada crua', () => {
  const bodies = MIGRATION_SQL.split('CREATE OR REPLACE FUNCTION').slice(1);
  assert.equal(bodies.length, 10);
  for (const b of bodies) assert.ok(!b.includes(OLD_SRC), b.slice(0, 80));
  const header = MIGRATION_SQL.split('CREATE OR REPLACE FUNCTION')[0];
  // a única citação fora das funções é a da própria fonte única (lê a tabela legada, mas só COMMITTED + snapshot mais novo)
  const code = header.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.equal((code.match(new RegExp(OLD_SRC, 'g')) || []).length, 1);
});
