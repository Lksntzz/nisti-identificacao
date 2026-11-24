// GA-018 — comportamento REAL da commerce_data_quality_v1 num Postgres 17 local descartável, com dados fictícios.
// Rodar: npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer, newDb, stage, commit, seedLegacyShopee } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(here, '../../supabase/migrations/20261124140000_commerce_data_quality_v1.sql');

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

const iso = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const T = (d) => `${d}T12:00:00-03:00`;
const day = (sku, units, rev, orders) => ({ sku, units, rev, orders });

// Tabelas que a função lê e que o esquema mínimo do harness não tem + GA-011 simulada (só o contrato de saída).
const EXTRA = `
create table public.commerce_marketplaces (id bigserial primary key, code text not null);
create table public.commerce_listings (id bigserial primary key, marketplace_id bigint not null, external_listing_id text not null,
  account_code text, last_checked_at timestamptz, raw_metadata jsonb);
create table public.commerce_listing_traffic_reports_v1 (id bigserial primary key, listing_id bigint, period_start date, period_end date, recorded_at timestamptz default now());
create table public.commerce_shopee_performance_reports_v1 (id bigserial primary key, period_start date, period_end date, imported_at timestamptz default now());
create table public.commerce_shopee_ads_reports_v1 (id bigserial primary key, period_start date, period_end date, inserted_at timestamptz default now());
create table public.commerce_shopee_aftercare_reports_v1 (id bigserial primary key, period_start date, period_end date, imported_at timestamptz default now());
create table public.commerce_ml_performance_reports_v1 (id bigserial primary key, account_code text, period_start date, period_end date, imported_at timestamptz default now());
insert into public.commerce_marketplaces(code) values ('SHOPEE'), ('MERCADO_LIVRE');
create or replace function public.commerce_shopee_reconciliation_v1(p_start date, p_end date, p_limit integer)
returns jsonb language sql stable as $$ select jsonb_build_object('status','COMPLETO',
  'reconciled_pct', jsonb_build_object('revenue', 99.88),
  'difference', jsonb_build_object('units', -2, 'revenue', -109.80, 'explained', true, 'residual_units', 0, 'residual_revenue', 0),
  'coverage', jsonb_build_object('source_missing_days', 0), 'unmatched_skus', jsonb_build_array(jsonb_build_object('sku_norm','X'))) $$;
`;

async function withDq(name, fn) {
  test(name, async () => {
    const db = await newDb();
    try {
      await db.main.query(EXTRA);
      await db.main.query(fs.readFileSync(MIGRATION, 'utf8'));
      db.dq = async (plat, s, e, detail = false) =>
        (await db.one('select public.commerce_data_quality_v1($1,$2::date,$3::date,$4) r', [plat, s, e, detail])).r;
      await fn(db);
    } finally { await db.close(); }
  });
}

withDq('plataforma desconhecida e período inválido são recusados', async (db) => {
  await assert.rejects(db.dq('AMAZON', '2026-10-01', '2026-10-02'), /plataforma invalida/);
  await assert.rejects(db.dq('SHOPEE', '2026-10-05', '2026-10-01'), /periodo invalido/);
});

withDq('cobertura: completo, parcial, com registros e sem informação ficam separados; dia ausente não vira zero', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-02': [day('AAA', 1, 10, ['o2'])], '2026-10-05': [day('AAA', 1, 10, ['o5'])] } });
  await commit(db, a);
  const r = await db.dq('SHOPEE', '2026-10-01', '2026-10-06');
  assert.equal(r.sales.requested_days, 6);
  assert.equal(r.sales.complete_days, 3);
  assert.equal(r.sales.days_without_information, 3, 'dias 3, 4 e 6 não têm linhas');
  assert.deepEqual(r.sales.missing_ranges.map((x) => [x.start, x.end, x.days]), [['2026-10-03', '2026-10-04', 2], ['2026-10-06', '2026-10-06', 1]]);
  assert.equal(r.sales.status, 'PARCIAL');
  assert.match(r.sales.note, /não prova que todos os pedidos/);
});

withDq('dia do arquivo gerado no mesmo dia aparece como parcial, não como completo', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-03'), days: {
    '2026-10-02': [day('AAA', 1, 10, ['o1'])], '2026-10-03': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, a);
  const r = await db.dq('SHOPEE', '2026-10-02', '2026-10-03');
  assert.equal(r.sales.complete_days, 1);
  assert.equal(r.sales.partial_days, 1);
});

withDq('sem nenhuma venda importada: SEM_INFORMACAO, nunca zero', async (db) => {
  const r = await db.dq('ML_NOVO', '2026-10-01', '2026-10-05');
  assert.equal(r.sales.status, 'SEM_INFORMACAO');
  assert.equal(r.sales.freshness, 'SEM_INFORMACAO');
  assert.equal(r.sales.last_sale_day, null);
  assert.equal(r.sales.reconciliation.status, 'SEM_INFORMACAO');
  assert.equal(r.sales.days_behind, null);
});

withDq('atualização e conciliação são independentes: fonte conciliada pode estar desatualizada', async (db) => {
  const a = await stage(db, { file: 'old.xlsx', created: T(iso(-9)), days: { [iso(-10)]: [day('AAA', 2, 20, ['o1'])] } });
  await commit(db, a);
  const r = await db.dq('SHOPEE', iso(-12), iso(-8));
  assert.equal(r.sales.freshness, 'DESATUALIZADO');
  assert.equal(r.sales.days_behind, 10);
  assert.equal(r.sales.reconciliation.status, 'CONCILIADO_INTERNAMENTE');
  assert.match(r.sales.reconciliation.scope, /não conferido no marketplace/);
});

withDq('limite de vendas: atraso de 1 dia ainda é atualizado, 2 dias é desatualizado', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T(iso(-1)), days: { [iso(-1)]: [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, a);
  assert.equal((await db.dq('SHOPEE', iso(-3), iso(0))).sales.freshness, 'ATUALIZADO');
  const b = await stage(db, { platform: 'ML_ANTIGO', file: 'b.xlsx', created: T(iso(-2)), days: { [iso(-2)]: [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, b);
  assert.equal((await db.dq('ML_ANTIGO', iso(-3), iso(0))).sales.freshness, 'DESATUALIZADO');
});

withDq('isolamento entre plataformas: dias, vendas e lotes de uma não aparecem na outra', async (db) => {
  const s = await stage(db, { file: 's.xlsx', created: T('2026-10-10'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, s);
  const m = await stage(db, { platform: 'ML_ANTIGO', file: 'm.xlsx', created: T('2026-10-10'), days: { '2026-10-02': [day('BBB', 5, 50, ['p1'])] } });
  await commit(db, m);
  await stage(db, { platform: 'ML_NOVO', file: 'aberto.xlsx', created: T('2026-10-11'), days: { '2026-10-03': [day('CCC', 1, 5, ['q1'])] } });
  const sh = await db.dq('SHOPEE', '2026-10-01', '2026-10-03');
  const ml = await db.dq('ML_ANTIGO', '2026-10-01', '2026-10-03');
  const mn = await db.dq('ML_NOVO', '2026-10-01', '2026-10-03');
  assert.equal(sh.sales.complete_days, 1); assert.equal(ml.sales.complete_days, 1);
  assert.equal(mn.sales.complete_days, 0);
  assert.equal(sh.sales.last_sale_day, '2026-10-01'); assert.equal(ml.sales.last_sale_day, '2026-10-02');
  assert.deepEqual(sh.open_batches, []); assert.deepEqual(ml.open_batches, []);
  assert.deepEqual(mn.open_batches.map((x) => x.file), ['aberto.xlsx']);
  assert.equal(sh.ml_unlinked_sales, null, 'ML_* não se aplica à Shopee');
  assert.equal(ml.ga011_shopee, null, 'GA-011 só existe para a Shopee');
});

withDq('conciliação GA-019 é repassada e uma divergência no resumo aparece como DIVERGENTE', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), days: { '2026-10-01': [day('AAA', 3, 30, ['o1'])] } });
  await commit(db, a);
  const ok = await db.dq('SHOPEE', '2026-10-01', '2026-10-31');
  const direct = await db.q(`select * from public.commerce_sales_reconcile_v2('SHOPEE')`);
  assert.equal(ok.sales.reconciliation.months_checked, direct.length);
  assert.equal(ok.sales.reconciliation.status, 'CONCILIADO_INTERNAMENTE');
  await db.q(`update commerce_sales_summary_rows set units = units + 1 where platform_code = 'SHOPEE'`);
  const bad = await db.dq('SHOPEE', '2026-10-01', '2026-10-31');
  assert.equal(bad.sales.reconciliation.status, 'DIVERGENTE');
  assert.equal(bad.sales.reconciliation.divergent_months.length, 1);
});

withDq('GA-011 é repassada para a Shopee; lista de SKUs só no detalhe', async (db) => {
  const a = await dqSimple(db);
  assert.equal(a.ga011_shopee.coverage_status, 'COMPLETO');
  assert.equal(a.ga011_shopee.reconciliation_status, 'CONCILIADO_INTERNAMENTE');
  assert.equal(a.ga011_shopee.unmatched_sku_count, 1);
  assert.equal(a.ga011_shopee.unmatched_skus, null);
  const d = await db.dq('SHOPEE', '2026-10-01', '2026-10-02', true);
  assert.equal(d.ga011_shopee.unmatched_skus.length, 1);
});
async function dqSimple(db) {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, a);
  return db.dq('SHOPEE', '2026-10-01', '2026-10-02');
}

withDq('pedidos únicos: separa chave, resumo histórico, cobertura parcial e sem informação; contagem é por dia', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 2, 20, ['o1', 'o2'])], '2026-10-02': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, a);
  await seedLegacyShopee(db, { month: '2026-08', through: '2026-08-10', days: { '2026-08-01': [day('ZZZ', 1, 5, ['x1'])] }, blockOrders: 7, committedAt: T('2026-08-12') });
  const r = await db.dq('SHOPEE', '2026-08-01', '2026-10-31');
  const by = Object.fromEntries(r.sales.orders.map((o) => [o.month, o]));
  assert.equal(by['2026-10-01'].orders, 3, 'GA-019 conta por dia: o2 aparece em dois dias');
  assert.equal(by['2026-10-01'].basis, 'CHAVE'); assert.equal(by['2026-10-01'].verified_by_key, true);
  assert.equal(by['2026-10-01'].coverage, 'PARCIAL', 'só 2 de 31 dias do mês têm dado');
  assert.equal(by['2026-10-01'].days_by_key, 2); assert.equal(by['2026-10-01'].days_expected, 31);
  assert.equal(by['2026-08-01'].basis, 'RESUMO_HISTORICO'); assert.equal(by['2026-08-01'].verified_by_key, false);
  assert.equal(by['2026-08-01'].orders, 7, 'número informado no resumo, não verificado por chave');
  assert.equal(by['2026-09-01'].basis, 'SEM_INFORMACAO'); assert.equal(by['2026-09-01'].orders, null, 'mês sem dado não vira 0');
  assert.equal(by['2026-09-01'].coverage, 'SEM_INFORMACAO');
  assert.match(r.sales.orders_note, /POR DIA/); assert.match(r.sales.months_scope_note, /MESES INTEIROS/);
});

withDq('pedidos únicos: mês com dias por chave e dias por resumo é MISTO e nunca verificado por chave', async (db) => {
  await seedLegacyShopee(db, { month: '2026-08', through: '2026-08-10', days: { '2026-08-01': [day('ZZZ', 1, 5, ['x1'])] }, blockOrders: 7, committedAt: T('2026-08-12') });
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-09-10'), days: { '2026-08-20': [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, a);
  const o = (await db.dq('SHOPEE', '2026-08-01', '2026-08-31')).sales.orders.find((x) => x.month === '2026-08-01');
  assert.equal(o.basis, 'MISTO'); assert.equal(o.verified_by_key, false);
  assert.equal(o.days_by_key, 1); assert.equal(o.days_by_summary, 1);
});

withDq('pedidos: duas partes com venda no mesmo dia contam o dia uma vez e a cobertura nunca passa de 100%', async (db) => {
  const range = (a, b) => { const o = {}; for (let d = a; d <= b; d += 1) o[`2026-09-${String(d).padStart(2, '0')}`] = [day('AAA', 1, 10, [`p${d}`])]; return o; };
  const p1 = await stage(db, { file: 'Order.all.parte1.xlsx', created: T('2026-10-05'), days: range(1, 15) });
  await commit(db, p1);
  const p2 = await stage(db, { file: 'Order.all.parte2.xlsx', created: T('2026-10-06'), days: range(15, 30) });
  await commit(db, p2);
  const o = (await db.dq('SHOPEE', '2026-09-01', '2026-09-30')).sales.orders.find((x) => x.month === '2026-09-01');
  assert.equal(o.days_with_data, 30, 'dia 15 está nas duas partes e conta uma vez');
  assert.equal(o.days_expected, 30);
  assert.ok(o.days_with_data <= o.days_expected);
  assert.equal(Number(o.data_coverage_pct), 100);
  assert.equal(o.days_by_key + o.days_by_summary, o.days_with_data);
  assert.equal(o.coverage, 'COMPLETA'); assert.equal(o.includes_partial_day, false); assert.equal(o.days_partial, 0);
  assert.equal(o.verified_by_key, true); assert.equal(Number(o.key_coverage_pct), 100);
});

withDq('pedidos: cobertura por chave é diferente de dia completo; o dia atual é parcial mesmo com 100% por chave', async (db) => {
  const today = iso(0);
  const first = today.slice(0, 8) + '01';
  const days = {}; const todayN = Number(today.slice(8));
  for (let d = 1; d <= todayN; d += 1) days[first.slice(0, 8) + String(d).padStart(2, '0')] = [day('AAA', 1, 10, [`q${d}`])];
  const a = await stage(db, { file: 'Order.all.mes.xlsx', created: `${today}T09:00:00-03:00`, days });
  await commit(db, a);
  const o = (await db.dq('SHOPEE', first, today)).sales.orders[0];
  assert.equal(o.days_with_data, todayN); assert.equal(o.days_expected, todayN);
  assert.equal(Number(o.key_coverage_pct), 100, 'todos os dias com dado vêm de chave');
  assert.equal(o.basis, 'CHAVE');
  assert.ok(o.days_partial >= 1, 'o dia de hoje não está fechado'); assert.equal(o.includes_partial_day, true);
  assert.equal(o.days_complete + o.days_partial, o.days_with_data);
  assert.equal(o.coverage, 'PARCIAL', '100% por chave não significa dia completo');
});

withDq('GA-011: COMPLETO é cobertura; resíduo ou diferença não explicada impede conciliação aprovada', async (db) => {
  await db.q(`create or replace function public.commerce_shopee_reconciliation_v1(p_start date, p_end date, p_limit integer)
    returns jsonb language sql stable as $$ select jsonb_build_object('status','COMPLETO','reconciled_pct', jsonb_build_object('revenue', 99),
    'difference', jsonb_build_object('explained', false, 'residual_units', 3, 'residual_revenue', 12.5), 'coverage', jsonb_build_object('source_missing_days', 0),
    'unmatched_skus', '[]'::jsonb) $$`);
  const r = (await db.dq('SHOPEE', '2026-10-01', '2026-10-02')).ga011_shopee;
  assert.equal(r.coverage_status, 'COMPLETO');
  assert.equal(r.reconciliation_status, 'DIVERGENTE');
  assert.equal(r.residual_units, 3); assert.equal(Number(r.residual_revenue), 12.5);
  await db.q(`create or replace function public.commerce_shopee_reconciliation_v1(p_start date, p_end date, p_limit integer)
    returns jsonb language sql stable as $$ select jsonb_build_object('status','COMPLETO','difference', jsonb_build_object('explained', true, 'residual_units', 0, 'residual_revenue', 0.4)) $$`);
  assert.equal((await db.dq('SHOPEE', '2026-10-01', '2026-10-02')).ga011_shopee.reconciliation_status, 'DIVERGENTE', 'explicada mas com resíduo de receita');
  await db.q(`create or replace function public.commerce_shopee_reconciliation_v1(p_start date, p_end date, p_limit integer)
    returns jsonb language sql stable as $$ select jsonb_build_object('status','SEM_DADOS') $$`);
  assert.equal((await db.dq('SHOPEE', '2026-10-01', '2026-10-02')).ga011_shopee.reconciliation_status, 'SEM_INFORMACAO');
});

withDq('ML sem nenhuma venda no período: SEM_INFORMACAO, sem totais zerados', async (db) => {
  const r = await db.dq('ML_ANTIGO', '2026-10-01', '2026-10-05');
  assert.equal(r.ml_unlinked_sales.severity, 'SEM_INFORMACAO');
  assert.equal(r.ml_unlinked_sales.total_units, undefined);
  assert.equal(r.ml_unlinked_sales.total_revenue, undefined);
  assert.equal(r.price_stock.realized_price.listings_with_units, null);
});

withDq('catálogo: situação por anúncio, com quantidade e percentual; a data mais recente não basta', async (db) => {
  const sh = (await db.one(`select id from commerce_marketplaces where code='SHOPEE'`)).id;
  await db.q(`insert into commerce_listings(marketplace_id, external_listing_id, last_checked_at) values
    ($1,'S1', now()), ($1,'S2', now() - interval '20 days'), ($1,'S3', now() - interval '9 days'), ($1,'S4', null)`, [sh]);
  const c = (await db.dq('SHOPEE', iso(-3), iso(0))).catalog;
  assert.equal(c.listings, 4); assert.equal(c.fresh_listings, 1); assert.equal(c.stale_listings, 2); assert.equal(c.never_checked_listings, 1);
  assert.equal(c.not_fresh_listings, 3); assert.equal(Number(c.not_fresh_pct), 75);
  assert.equal(c.freshness, 'PARCIALMENTE_DESATUALIZADO', 'um anúncio recente não torna o catálogo todo atualizado');
  assert.equal(c.days_since_oldest_check, 20);
  assert.doesNotMatch(c.note, /só anúncios ativos/);
  assert.match(c.note, /não garante que todos sejam ativos/);
});

withDq('preço e estoque: sem valor válido, parcial e foto disponível; estoque repetido é indício de nominal e nunca estoque real', async (db) => {
  const sh = (await db.one(`select id from commerce_marketplaces where code='SHOPEE'`)).id;
  const ins = (id, vars) => db.q(`insert into commerce_listings(marketplace_id, external_listing_id, last_checked_at, raw_metadata) values ($1,$2, now(), $3::jsonb)`,
    [sh, id, JSON.stringify({ shopee_sales_info: { variations: vars } })]);
  await ins('A', [{ price: '0', stock: 'x' }, { price: null, stock: null }]);
  let r = (await db.dq('SHOPEE', iso(-3), iso(0))).price_stock;
  assert.equal(r.registered_price.status, 'SEM_VALOR_VALIDO'); assert.equal(r.stock.status, 'SEM_VALOR_VALIDO');
  await ins('B', [{ price: '10.50', stock: '3' }]);
  r = (await db.dq('SHOPEE', iso(-3), iso(0))).price_stock;
  assert.equal(r.registered_price.status, 'PARCIAL'); assert.equal(r.registered_price.variations_without_valid_price, 2);
  assert.equal(r.stock.status, 'PARCIAL');
  await db.q(`delete from commerce_listings where external_listing_id = 'A'`);
  r = (await db.dq('SHOPEE', iso(-3), iso(0))).price_stock;
  assert.equal(r.registered_price.status, 'DISPONIVEL_FOTO'); assert.equal(r.stock.status, 'DISPONIVEL_FOTO');
  assert.equal(r.stock.is_real_stock, false); assert.equal(r.stock.real_time, false); assert.equal(r.stock.possibly_nominal, false, 'só 1 variação: sem indício');
  const many = Array.from({ length: 12 }, (_, i) => ({ price: '5', stock: i < 9 ? '4999' : String(i) }));
  await ins('C', many);
  r = (await db.dq('SHOPEE', iso(-3), iso(0))).price_stock;
  assert.equal(r.stock.most_common_value, '4999'); assert.equal(r.stock.possibly_nominal, true); assert.equal(r.stock.is_real_stock, false);
});

withDq('relatórios: período informado nunca é cobertura diária; sobrepostos são contados; sem relatório = SEM_INFORMACAO', async (db) => {
  await db.q(`insert into commerce_shopee_performance_reports_v1(period_start, period_end) values ($1,$2), ($3,$4)`,
    [iso(-40), iso(-10), iso(-20), iso(-5)]);
  await db.q(`insert into commerce_shopee_ads_reports_v1(period_start, period_end) values ($1,$2)`, [iso(-80), iso(-60)]);
  const r = await db.dq('SHOPEE', iso(-30), iso(-1));
  const k = Object.fromEntries(r.reports.map((x) => [x.kind, x]));
  assert.equal(k.DESEMPENHO.reports, 2); assert.equal(k.DESEMPENHO.overlapping_report_pairs, 1);
  assert.equal(k.DESEMPENHO.freshness, 'ATUALIZADO'); assert.equal(k.DESEMPENHO.daily_coverage_proven, false);
  assert.equal(k.DESEMPENHO.period_overlaps_requested, true);
  assert.equal(k.ADS.freshness, 'DESATUALIZADO', 'terminou há 60 dias (> 30)');
  assert.equal(k.ADS.period_overlaps_requested, false);
  assert.equal(k.POS_VENDA.freshness, 'SEM_INFORMACAO'); assert.equal(k.POS_VENDA.period_overlaps_requested, null);
  assert.equal(k.TRAFEGO_MANUAL.freshness, 'SEM_INFORMACAO');
});

withDq('relatórios de ML são isolados por conta e Ads do ML é sempre SEM_INFORMACAO', async (db) => {
  await db.q(`insert into commerce_ml_performance_reports_v1(account_code, period_start, period_end) values ('NOVO', $1, $2)`, [iso(-20), iso(-2)]);
  const nov = await db.dq('ML_NOVO', iso(-10), iso(0));
  const ant = await db.dq('ML_ANTIGO', iso(-10), iso(0));
  const kn = Object.fromEntries(nov.reports.map((x) => [x.kind, x])); const ka = Object.fromEntries(ant.reports.map((x) => [x.kind, x]));
  assert.equal(kn.DESEMPENHO.reports, 1); assert.equal(ka.DESEMPENHO.reports, 0);
  assert.equal(ka.DESEMPENHO.freshness, 'SEM_INFORMACAO');
  assert.equal(kn.ADS_ML.freshness, 'SEM_INFORMACAO');
});

withDq('ML: vendas sem anúncio cadastrado são informativas, ficam nos totais e a conta é respeitada', async (db) => {
  const mk = (await db.one(`select id from commerce_marketplaces where code='MERCADO_LIVRE'`)).id;
  await db.q(`insert into commerce_listings(marketplace_id, external_listing_id, account_code) values ($1,'L-AAA','ANTIGO'), ($1,'L-BBB','NOVO')`, [mk]);
  const m = await stage(db, { platform: 'ML_ANTIGO', file: 'm.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 3, 30, ['p1']), day('BBB', 1, 70, ['p2']), day('CCC', 1, 100, ['p3'])] } });
  await commit(db, m);
  const r = await db.dq('ML_ANTIGO', '2026-10-01', '2026-10-02');
  const u = r.ml_unlinked_sales;
  assert.equal(u.severity, 'INFORMATIVO');
  assert.equal(u.listings_with_sales, 3);
  assert.equal(u.listings_without_registered_listing, 2, 'L-BBB só existe na conta NOVO; L-CCC não existe');
  assert.equal(Number(u.revenue_without_registered_listing), 170);
  assert.equal(Number(u.total_revenue), 200, 'as vendas sem anúncio continuam nos totais');
  assert.equal(Number(u.pct_revenue), 85);
  assert.equal(u.items, null);
  const d = await db.dq('ML_ANTIGO', '2026-10-01', '2026-10-02', true);
  assert.equal(d.ml_unlinked_sales.items.length, 2);
});

withDq('catálogo: > 7 dias é desatualizado; sem verificação é SEM_INFORMACAO; plataformas isoladas', async (db) => {
  const sh = (await db.one(`select id from commerce_marketplaces where code='SHOPEE'`)).id;
  const ml = (await db.one(`select id from commerce_marketplaces where code='MERCADO_LIVRE'`)).id;
  await db.q(`insert into commerce_listings(marketplace_id, external_listing_id, last_checked_at) values ($1,'S1', now() - interval '8 days')`, [sh]);
  await db.q(`insert into commerce_listings(marketplace_id, external_listing_id, account_code, last_checked_at) values ($1,'M1','ANTIGO', now() - interval '1 day'), ($1,'M2','NOVO', null)`, [ml]);
  assert.equal((await db.dq('SHOPEE', iso(-3), iso(0))).catalog.freshness, 'DESATUALIZADO');
  assert.equal((await db.dq('ML_ANTIGO', iso(-3), iso(0))).catalog.freshness, 'ATUALIZADO');
  const n = (await db.dq('ML_NOVO', iso(-3), iso(0))).catalog;
  assert.equal(n.freshness, 'SEM_INFORMACAO'); assert.equal(n.never_checked_listings, 1);
});

withDq('preço cadastrado, preço realizado e estoque são separados; estoque é foto, não tempo real', async (db) => {
  const sh = (await db.one(`select id from commerce_marketplaces where code='SHOPEE'`)).id;
  await db.q(`insert into commerce_listings(marketplace_id, external_listing_id, last_checked_at, raw_metadata) values ($1,'S1', now(),
    '{"shopee_sales_info":{"variations":[{"price":"89.90","stock":"4"},{"price":null,"stock":"x"}]}}')`, [sh]);
  const s = await stage(db, { file: 's.xlsx', created: T('2026-10-10'), days: { '2026-10-01': [day('AAA', 2, 20, ['o1'])] } });
  await commit(db, s);
  const r = await db.dq('SHOPEE', '2026-10-01', '2026-10-02');
  assert.equal(r.price_stock.registered_price.variations, 2);
  assert.equal(r.price_stock.registered_price.variations_with_price, 1);
  assert.equal(r.price_stock.stock.variations_with_stock, 1);
  assert.equal(r.price_stock.stock.real_time, false);
  assert.equal(r.price_stock.realized_price.source, 'VENDAS_IMPORTADAS');
  const ml = await db.dq('ML_ANTIGO', '2026-10-01', '2026-10-02');
  assert.equal(ml.price_stock.stock.status, 'SEM_INFORMACAO');
  assert.equal(ml.price_stock.registered_price.status, 'SEM_INFORMACAO');
});

withDq('período filtra: dias fora do período não entram na cobertura', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-15': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, a);
  const r1 = await db.dq('SHOPEE', '2026-10-01', '2026-10-05');
  const r2 = await db.dq('SHOPEE', '2026-10-10', '2026-10-16');
  assert.equal(r1.sales.complete_days, 1); assert.equal(r1.sales.requested_days, 5);
  assert.equal(r2.sales.complete_days, 1); assert.equal(r2.sales.requested_days, 7);
});

withDq('sem cache: nova importação muda o resultado na chamada seguinte', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, a);
  assert.equal((await db.dq('SHOPEE', '2026-10-01', '2026-10-03')).sales.complete_days, 1);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-11'), days: { '2026-10-02': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, b);
  assert.equal((await db.dq('SHOPEE', '2026-10-01', '2026-10-03')).sales.complete_days, 2);
  await db.q(`insert into commerce_shopee_ads_reports_v1(period_start, period_end) values ('2026-09-01','2026-09-30')`);
  assert.equal((await db.dq('SHOPEE', '2026-10-01', '2026-10-03')).reports.find((x) => x.kind === 'ADS').reports, 1, 'importação de Ads aparece na hora');
});

withDq('somente leitura e permissões: função é STABLE, só service_role executa, nada é gravado', async (db) => {
  const f = await db.one(`select p.provolatile, p.prosecdef, p.proacl::text acl from pg_proc p where p.proname = 'commerce_data_quality_v1'`);
  assert.equal(f.provolatile, 's'); assert.equal(f.prosecdef, false);
  assert.ok(f.acl.includes('service_role=X'), f.acl);
  assert.ok(!/(^|[{,])=X/.test(f.acl), 'PUBLIC sem execução');
  assert.ok(!f.acl.includes('anon=') && !f.acl.includes('authenticated='));
  const before = await db.one(`select (select count(*) from commerce_sales_import_batches) b, (select count(*) from commerce_sales_summary_rows) s`);
  await db.dq('SHOPEE', '2026-10-01', '2026-10-31', true);
  const after = await db.one(`select (select count(*) from commerce_sales_import_batches) b, (select count(*) from commerce_sales_summary_rows) s`);
  assert.deepEqual(after, before);
  await db.main.query('set role anon');
  await assert.rejects(db.main.query(`select public.commerce_data_quality_v1('SHOPEE', null, null, false)`), /permission denied/);
  await db.main.query('reset role');
});

withDq('desempenho: ano inteiro com 12 meses e 200 dias responde em menos de 5 s', async (db) => {
  const days = {};
  for (let i = 0; i < 200; i += 1) days[iso(-300 + i)] = [day('AAA', 1, 10, [`o${i}`])];
  const a = await stage(db, { file: 'big.xlsx', created: T(iso(-50)), days });
  await commit(db, a);
  const t0 = Date.now();
  const r = await db.dq('SHOPEE', iso(-364), iso(0), true);
  const ms = Date.now() - t0;
  console.log(`# commerce_data_quality_v1 (365 dias, 200 com vendas): ${ms} ms`);
  assert.ok(ms < 5000, `levou ${ms} ms`);
  assert.equal(r.sales.requested_days, 365);
  assert.ok(r.sales.orders.length <= 12);
});
