// GA-014 — commerce_decision_units_v1 num Postgres 17 local descartável, só com dados FICTÍCIOS.
// A migração é só um ARQUIVO nesta etapa: aqui ela roda no banco de teste, nunca no Supabase.
// A view real das vendas é coberta pelos testes da GA-019/GA-021; aqui um teste de contrato confere as colunas que a função usa
// e depois a view é trocada por uma tabela fictícia simples para controlar as vendas.
// Rodar: npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer, newDb } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.join(here, '../../supabase/migrations/20261125120000_commerce_decision_units_v1.sql'), 'utf8');
const FN = 'public.commerce_decision_units_v1(text,date,date,date,date,integer)';

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

// Esquema mínimo fictício das tabelas lidas (mesmos nomes e tipos das tabelas reais).
const DEPS = `
create table public.commerce_marketplaces (id bigserial primary key, code text not null);
create table public.commerce_listings (id bigserial primary key, marketplace_id bigint, external_listing_id text, listing_status text,
  title text, account_code text, last_checked_at timestamptz);
create table public.commerce_shopee_performance_reports_v1 (id bigserial primary key, period_start date, period_end date, imported_at timestamptz default now());
create table public.commerce_shopee_performance_rows_v1 (report_id bigint, external_item_id text, impressions bigint, clicks bigint, visitors bigint, orders_placed bigint);
create table public.commerce_ml_performance_reports_v1 (id bigserial primary key, account_code text, period_start date, period_end date, imported_at timestamptz default now());
create table public.commerce_ml_performance_rows_v1 (report_id bigint, external_listing_id text, variation text, visits bigint, sales_count bigint);
create table public.fx_sales (platform_code text, sale_date date, external_listing_id text, units integer, product_revenue numeric default 0);
drop view public.commerce_current_sales_listing_daily_v1;
create view public.commerce_current_sales_listing_daily_v1 as select platform_code, sale_date, external_listing_id, units, product_revenue from public.fx_sales;
insert into public.commerce_marketplaces(code) values ('SHOPEE'), ('MERCADO_LIVRE');
`;

async function withDb(name, fn) {
  test(name, async () => {
    const db = await newDb();
    try {
      const real = await db.q(`select column_name from information_schema.columns where table_schema='public' and table_name='commerce_current_sales_listing_daily_v1'`);
      const cols = real.map((r) => r.column_name);
      for (const c of ['platform_code', 'sale_date', 'external_listing_id', 'units']) assert.ok(cols.includes(c), `a view real precisa ter a coluna ${c}`);
      await db.main.query(DEPS);
      await db.main.query(MIGRATION);
      await fn(db);
    } finally { await db.close(); }
  });
}

const call = (db, p = 'SHOPEE', cs = '2026-11-17', ce = '2026-11-23', ps = '2026-11-10', pe = '2026-11-16', lim = 3000) =>
  db.one(`select public.commerce_decision_units_v1($1,$2::date,$3::date,$4::date,$5::date,$6) r`, [p, cs, ce, ps, pe, lim]).then((x) => x.r);
const sale = (db, pc, ext, day, units) => db.q(`insert into fx_sales(platform_code,sale_date,external_listing_id,units,product_revenue) values ($1,$2,$3,$4,99.9)`, [pc, day, ext, units]);
const listing = (db, mk, ext, status, title, acct = null, checked = '2026-11-17T10:00:00Z') =>
  db.q(`insert into commerce_listings(marketplace_id,external_listing_id,listing_status,title,account_code,last_checked_at)
        values ((select id from commerce_marketplaces where code=$1),$2,$3,$4,$5,$6)`, [mk, ext, status, title, acct, checked]);
const rowOf = (r, ext) => r.rows.find((x) => x.ext === ext);

withDb('unidades por anúncio: atual, anterior, primeira e última venda, ordenadas pelo volume', async (db) => {
  await listing(db, 'SHOPEE', '111', 'ACTIVE', 'Anúncio A');
  await listing(db, 'SHOPEE', '222', 'ACTIVE', 'Anúncio B');
  await sale(db, 'SHOPEE', '111', '2026-11-12', 10); await sale(db, 'SHOPEE', '111', '2026-11-20', 4);
  await sale(db, 'SHOPEE', '222', '2026-11-11', 1); await sale(db, 'SHOPEE', '222', '2026-11-18', 2);
  await sale(db, 'SHOPEE', '111', '2026-11-24', 50); // dia fora dos dois períodos: não entra
  await sale(db, 'SHOPEE', '111', '2026-01-05', 3);  // histórico antigo: só vira primeira venda
  const r = await call(db);
  assert.deepEqual(r.rows.map((x) => x.ext), ['111', '222'], 'ordem por volume');
  const a = rowOf(r, '111');
  assert.equal(a.units_current, 4); assert.equal(a.units_previous, 10);
  assert.equal(a.first_sale, '2026-01-05'); assert.equal(a.last_sale, '2026-11-24');
  assert.equal(r.totals.units_current, 6); assert.equal(r.totals.units_previous, 11);
  assert.equal(r.totals.listings_with_sales, 2);
  assert.deepEqual(r.current, { start: '2026-11-17', end: '2026-11-23' });
});

withDb('identidade conta + ID: mesmo ID em contas diferentes não se mistura nem invalida as vendas', async (db) => {
  await listing(db, 'MERCADO_LIVRE', 'MLB1', 'ACTIVE', 'Antigo', 'ANTIGO');
  await listing(db, 'MERCADO_LIVRE', 'MLB1', 'PAUSED', 'Novo', 'NOVO');
  await sale(db, 'ML_ANTIGO', 'MLB1', '2026-11-18', 7); await sale(db, 'ML_NOVO', 'MLB1', '2026-11-18', 2);
  const a = await call(db, 'ML_ANTIGO'); const n = await call(db, 'ML_NOVO');
  assert.equal(rowOf(a, 'MLB1').units_current, 7); assert.equal(rowOf(a, 'MLB1').status, 'ACTIVE'); assert.equal(rowOf(a, 'MLB1').title, 'Antigo');
  assert.equal(rowOf(n, 'MLB1').units_current, 2); assert.equal(rowOf(n, 'MLB1').status, 'PAUSED'); assert.equal(rowOf(n, 'MLB1').ambiguous_status, false);
  const s = await call(db, 'SHOPEE');
  assert.equal(s.rows.length, 0, 'a Shopee não enxerga o ID do ML');
});

withDb('venda sem cadastro continua contada e identificada; cadastro repetido na mesma conta só esconde título e situação', async (db) => {
  await sale(db, 'SHOPEE', '900', '2026-11-18', 5); // sem cadastro
  await listing(db, 'SHOPEE', '901', 'ACTIVE', 'Dup 1'); await listing(db, 'SHOPEE', '901', 'PAUSED', 'Dup 2');
  await sale(db, 'SHOPEE', '901', '2026-11-18', 3);
  const r = await call(db);
  const u = rowOf(r, '900'); assert.equal(u.registered, false); assert.equal(u.units_current, 5); assert.equal(u.status, null);
  const d = rowOf(r, '901'); assert.equal(d.ambiguous_status, true); assert.equal(d.status, null); assert.equal(d.title, null); assert.equal(d.units_current, 3);
  assert.equal(r.totals.listings_unregistered, 1); assert.equal(r.totals.units_current_unregistered, 5);
  assert.equal(r.totals.listings_ambiguous_status, 1);
  assert.equal(r.totals.units_current, 8, 'nenhuma venda foi descartada nem redistribuída');
});

withDb('situação é o último estado cadastrado, com a data da verificação', async (db) => {
  await listing(db, 'SHOPEE', '111', 'PAUSED', 'A', null, '2026-11-15T08:30:00Z');
  await sale(db, 'SHOPEE', '111', '2026-11-18', 1);
  const a = rowOf(await call(db), '111');
  assert.equal(a.status, 'PAUSED'); assert.equal(Date.parse(a.status_checked_at), Date.parse('2026-11-15T08:30:00Z'), 'mesmo instante, qualquer fuso');
});

withDb('desempenho: relatório mais recente e o anterior SEM sobreposição, da mesma conta; variações do ML não somam', async (db) => {
  await db.q(`insert into commerce_shopee_performance_reports_v1(period_start,period_end) values ('2026-11-02','2026-11-08'),('2026-11-09','2026-11-15'),('2026-11-12','2026-11-22')`);
  // ids: 1 (02-08), 2 (09-15, sobrepõe o mais recente), 3 (12-22, o mais recente)
  await db.q(`insert into commerce_shopee_performance_rows_v1 values (1,'111',1000,50,300,6),(2,'111',9999,9,9,9),(3,'111',800,40,250,4),(3,'333',500,10,150,0)`);
  await listing(db, 'SHOPEE', '111', 'ACTIVE', 'A'); await sale(db, 'SHOPEE', '111', '2026-11-18', 1);
  const r = await call(db);
  assert.deepEqual(r.reports.latest.start, '2026-11-12'); assert.equal(r.reports.previous.end, '2026-11-08', 'o relatório 09–15 sobrepõe e fica de fora');
  const a = rowOf(r, '111');
  assert.deepEqual([a.perf.latest.impressions, a.perf.latest.visits, a.perf.latest.orders], [800, 250, 4]);
  assert.deepEqual([a.perf.previous.impressions, a.perf.previous.visits, a.perf.previous.orders], [1000, 300, 6]);
  const t = rowOf(r, '333'); assert.equal(t.units_current, 0, 'anúncio só do relatório entra com 0 unidades'); assert.equal(t.perf.previous, null);
  assert.equal(Number(r.reports.latest.store_visits), 400);

  await db.q(`insert into commerce_ml_performance_reports_v1(account_code,period_start,period_end) values ('NOVO','2026-01-01','2026-10-27'),('ANTIGO','2026-11-01','2026-11-20')`);
  await db.q(`insert into commerce_ml_performance_rows_v1 values (1,'MLB7','Azul',100,5),(1,'MLB7','Vermelho',80,3),(1,'MLB8',null,40,2),(2,'MLB9',null,500,20)`);
  await sale(db, 'ML_NOVO', 'MLB7', '2026-11-18', 2); await sale(db, 'ML_NOVO', 'MLB8', '2026-11-18', 1);
  const m = await call(db, 'ML_NOVO');
  assert.equal(rowOf(m, 'MLB7').perf.latest.ambiguous_rows, true); assert.equal(rowOf(m, 'MLB7').perf.latest.visits, null, 'duas linhas de variação: não soma, não chuta');
  assert.equal(rowOf(m, 'MLB8').perf.latest.visits, 40);
  assert.equal(rowOf(m, 'MLB9'), undefined, 'relatório de outra conta não entra');
  assert.equal(m.reports.latest.end, '2026-10-27');
  const none = await call(db, 'ML_ANTIGO'); assert.equal(rowOf(none, 'MLB9').perf.latest.visits, 500);
});

withDb('totais e contagens são calculados antes do limite da lista', async (db) => {
  for (let i = 1; i <= 5; i++) await sale(db, 'SHOPEE', String(1000 + i), '2026-11-18', i);
  const r = await call(db, 'SHOPEE', '2026-11-17', '2026-11-23', '2026-11-10', '2026-11-16', 2);
  assert.equal(r.rows.length, 2); assert.equal(r.truncated, true); assert.equal(r.row_count, 5);
  assert.equal(r.totals.units_current, 15); assert.equal(r.totals.listings_with_sales, 5);
  assert.deepEqual(r.rows.map((x) => x.ext), ['1005', '1004']);
});

withDb('valida conta, datas, períodos e limite', async (db) => {
  const bad = async (args, re) => { await assert.rejects(() => call(db, ...args), re); };
  await bad(['TODAS'], /plataforma inválida/); await bad([null], /plataforma inválida/); await bad(['shopee'], /plataforma inválida/);
  await bad(['SHOPEE', null], /datas obrigatórias/);
  await bad(['SHOPEE', '2026-11-23', '2026-11-17'], /início depois do fim/);
  await bad(['SHOPEE', '2026-11-17', '2026-11-23', '2026-11-12', '2026-11-18'], /anterior deve terminar antes/);
  await bad(['SHOPEE', '2026-11-17', '2026-11-23', '2026-11-10', '2026-11-15'], /tamanhos diferentes/);
  await bad(['SHOPEE', '2026-11-01', '2026-11-30', '2026-09-01', '2026-09-29'], /tamanhos diferentes/);
  await bad(['SHOPEE', '2026-08-01', '2026-11-23', '2026-02-01', '2026-05-26'], /1 a 93 dias/);
  await bad(['SHOPEE', '2026-11-17', '2026-11-23', '2026-11-10', '2026-11-16', 0], /limite/);
  await bad(['SHOPEE', '2026-11-17', '2026-11-23', '2026-11-10', '2026-11-16', 5001], /limite/);
  await bad(['SHOPEE', '2026-11-17', '2026-11-23', '2026-11-10', '2026-11-16', null], /limite/);
});

withDb('somente leitura, sem receita, SECURITY INVOKER, search_path explícito e só o service_role executa', async (db) => {
  await sale(db, 'SHOPEE', '111', '2026-11-18', 3);
  const before = await db.one(`select count(*)::int n, coalesce(sum(units),0)::int u from fx_sales`);
  const r = await call(db);
  assert.ok(!/revenue|receita|ticket|margin|profit|price/i.test(JSON.stringify(r)), 'a resposta não traz nenhum campo financeiro');
  const f = await db.one(`select p.provolatile v, p.prosecdef sd, p.proconfig cfg, p.proacl::text acl from pg_proc p where p.oid = '${FN}'::regprocedure`);
  assert.equal(f.v, 's', 'STABLE'); assert.equal(f.sd, false, 'SECURITY INVOKER');
  assert.ok(f.cfg.some((c) => /^search_path=public, pg_temp$/.test(c)), String(f.cfg));
  assert.ok(f.acl.includes('service_role=X')); assert.ok(!f.acl.includes('anon=') && !f.acl.includes('authenticated=') && !/^=X|,=X/.test(f.acl), f.acl);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.one(`select has_function_privilege('${role}', '${FN}', 'execute') ok`)).ok, false, role);
  }
  await db.main.query('set role anon');
  await assert.rejects(() => call(db), /permission denied/);
  await db.main.query('reset role');
  assert.deepEqual(await db.one(`select count(*)::int n, coalesce(sum(units),0)::int u from fx_sales`), before, 'nada foi gravado');
  assert.ok(!/\b(insert|update|delete|truncate)\b|create table/i.test(MIGRATION.replace(/--.*$/gm, '').split('$fn$')[1]), 'o corpo da função não contém escrita');
});

withDb('desempenho: 1.500 anúncios com 14 dias de venda e relatórios respondem rápido', async (db) => {
  await db.q(`insert into commerce_listings(marketplace_id,external_listing_id,listing_status,title)
    select (select id from commerce_marketplaces where code='SHOPEE'), g::text, 'ACTIVE', 't'||g from generate_series(1,1500) g`);
  await db.q(`insert into fx_sales(platform_code,sale_date,external_listing_id,units)
    select 'SHOPEE', d::date, g::text, 1 + (g % 5) from generate_series(1,1500) g, generate_series(date '2026-11-10', date '2026-11-23', interval '1 day') d`);
  await db.q(`insert into commerce_shopee_performance_reports_v1(period_start,period_end) values ('2026-11-02','2026-11-08'),('2026-11-12','2026-11-22')`);
  await db.q(`insert into commerce_shopee_performance_rows_v1 select r, g::text, 1000, 50, 200, 5 from generate_series(1,1500) g, generate_series(1,2) r`);
  const t0 = Date.now(); const r = await call(db); const ms = Date.now() - t0;
  assert.equal(r.row_count, 1500); assert.equal(r.truncated, false);
  assert.ok(ms < 3000, `demorou ${ms} ms`);
});

// ---- Revisão técnica (itens 1 a 3) ----
withDb('item 1: anúncio cadastrado sem vendas e sem relatório entra (com 0 unidades) e é identificado', async (db) => {
  await listing(db, 'SHOPEE', '111', 'ACTIVE', 'Com venda');
  await listing(db, 'SHOPEE', '555', 'PAUSED', 'Parado sem relatório');
  await listing(db, 'SHOPEE', '777', 'ACTIVE', 'Repetido 1'); await listing(db, 'SHOPEE', '777', 'ACTIVE', 'Repetido 2');
  await listing(db, 'MERCADO_LIVRE', '555', 'ACTIVE', 'Outra conta, mesmo ID', 'NOVO');
  await sale(db, 'SHOPEE', '111', '2026-11-20', 3);
  const r = await call(db);
  const z = rowOf(r, '555');
  assert.ok(z, 'o anúncio cadastrado sem venda e sem relatório precisa existir na lista');
  assert.deepEqual([z.units_current, z.units_previous, z.registered, z.status, z.title, z.in_report, z.last_sale], [0, 0, true, 'PAUSED', 'Parado sem relatório', false, null]);
  const rep = rowOf(r, '777'); assert.equal(rep.ambiguous_status, true); assert.equal(rep.title, null, 'cadastro repetido não escolhe um título');
  assert.equal(r.rows.filter((x) => x.ext === '555').length, 1, 'a outra conta não duplica nem entra');
  assert.equal(r.totals.listings, 3); assert.equal(r.totals.listings_registered, 3); assert.equal(r.totals.listings_with_sales, 1); assert.equal(r.totals.listings_without_sales, 2);
  const m = await call(db, 'ML_NOVO');
  assert.deepEqual(m.rows.map((x) => x.ext), ['555'], 'ML Novo só vê o cadastro da própria conta'); assert.equal(m.rows[0].title, 'Outra conta, mesmo ID');
  const a = await call(db, 'ML_ANTIGO'); assert.equal(a.rows.length, 0); assert.equal(a.totals.listings, 0);
});

withDb('item 1: cadastro sem ID externo não vira anúncio, é contado à parte; venda sem ID não é atribuída a ninguém', async (db) => {
  await listing(db, 'SHOPEE', null, 'ACTIVE', 'Sem ID'); await listing(db, 'SHOPEE', '  ', 'ACTIVE', 'ID em branco'); await listing(db, 'SHOPEE', '111', 'ACTIVE', 'Normal');
  await sale(db, 'SHOPEE', null, '2026-11-20', 7); await sale(db, 'SHOPEE', '', '2026-11-12', 2); await sale(db, 'SHOPEE', '111', '2026-11-20', 1);
  const r = await call(db);
  assert.deepEqual(r.rows.map((x) => x.ext), ['111']);
  assert.equal(r.totals.listings_without_external_id, 2);
  assert.equal(r.reconciliation.current.units_without_id, 7); assert.equal(r.reconciliation.previous.units_without_id, 2);
});

withDb('item 2: conciliação dos dois períodos separa sem ID, sem cadastro, cadastradas e resíduo (zero quando fecha)', async (db) => {
  await listing(db, 'SHOPEE', '111', 'ACTIVE', 'A');
  await sale(db, 'SHOPEE', '111', '2026-11-20', 4); await sale(db, 'SHOPEE', '111', '2026-11-12', 5);
  await sale(db, 'SHOPEE', '999', '2026-11-21', 3); await sale(db, 'SHOPEE', '999', '2026-11-13', 1); // sem cadastro
  await sale(db, 'SHOPEE', null, '2026-11-22', 2);
  await sale(db, 'ML_NOVO', '111', '2026-11-20', 50); // outra conta: fora
  const r = await call(db);
  const c = r.reconciliation.current, p = r.reconciliation.previous;
  assert.deepEqual([c.source_units, c.units_registered, c.units_unregistered, c.units_without_id, c.unexplained_units], [9, 4, 3, 2, 0]);
  assert.deepEqual([p.source_units, p.units_registered, p.units_unregistered, p.units_without_id, p.unexplained_units], [6, 5, 1, 0, 0]);
  assert.equal(c.rows_units, 7); assert.equal(p.rows_units, 6);
  assert.equal(r.totals.units_current, 7, 'a soma das linhas não inclui a venda sem ID'); assert.equal(r.totals.units_previous, 6);
  assert.equal(r.reconciliation.status, 'CONCILIADA');
});

withDb('item 2: totais e conciliação continuam corretos quando a lista é cortada pelo limite', async (db) => {
  for (let i = 1; i <= 6; i++) { await listing(db, 'SHOPEE', 'L' + i, 'ACTIVE', 'T' + i); await sale(db, 'SHOPEE', 'L' + i, '2026-11-20', i); }
  const r = await call(db, 'SHOPEE', '2026-11-17', '2026-11-23', '2026-11-10', '2026-11-16', 2);
  assert.equal(r.rows.length, 2); assert.equal(r.truncated, true); assert.equal(r.row_count, 6);
  assert.equal(r.totals.units_current, 21); assert.equal(r.reconciliation.current.rows_units, 21, 'conciliação usa todos os anúncios, não só a lista cortada');
});

withDb('item 3: relatórios com durações diferentes trazem dias e valores por dia; sem anterior fica marcado', async (db) => {
  await listing(db, 'SHOPEE', '111', 'ACTIVE', 'A'); await sale(db, 'SHOPEE', '111', '2026-11-20', 1);
  await db.q(`insert into commerce_shopee_performance_reports_v1(period_start,period_end) values ('2026-10-06','2026-11-04'),('2026-11-16','2026-11-22')`); // 30 dias e 7 dias
  await db.q(`insert into commerce_shopee_performance_rows_v1 values (1,'111',3000,300,900,30),(2,'111',700,70,140,7)`);
  const r = await call(db);
  assert.equal(r.reports.latest.days, 7); assert.equal(r.reports.previous.days, 30); assert.equal(r.reports.gap_days, 11);
  assert.equal(r.reports.comparable.ok, true);
  const a = rowOf(r, '111');
  assert.deepEqual([a.perf.latest.impressions_per_day, a.perf.latest.visits_per_day, a.perf.latest.orders_per_day], [100, 20, 1]);
  assert.deepEqual([a.perf.previous.impressions_per_day, a.perf.previous.visits_per_day, a.perf.previous.orders_per_day], [100, 30, 1]);
  assert.equal(a.perf.latest.impressions, 700, 'o valor bruto continua disponível');
  const solo = await newDb();
  try {
    await solo.main.query(DEPS); await solo.main.query(MIGRATION);
    await solo.q(`insert into commerce_shopee_performance_reports_v1(period_start,period_end) values ('2026-11-16','2026-11-22')`);
    const s = await call(solo);
    assert.equal(s.reports.previous, null); assert.equal(s.reports.comparable.ok, false); assert.equal(s.reports.comparable.reason, 'SEM_RELATORIO_ANTERIOR');
    await solo.q(`delete from commerce_shopee_performance_reports_v1`);
    const n = await call(solo); assert.equal(n.reports.latest, null); assert.equal(n.reports.comparable.ok, false); assert.equal(n.reports.comparable.reason, 'SEM_RELATORIO');
  } finally { await solo.close(); }
});

withDb('item 3: por dia só quando a linha do relatório é única (variação do ML continua ambígua)', async (db) => {
  await db.q(`insert into commerce_ml_performance_reports_v1(account_code,period_start,period_end) values ('NOVO','2026-11-16','2026-11-22')`);
  await db.q(`insert into commerce_ml_performance_rows_v1 values (1,'MLB7','Azul',70,5),(1,'MLB7','Vermelho',70,3),(1,'MLB8',null,70,2)`);
  const m = await call(db, 'ML_NOVO');
  assert.equal(rowOf(m, 'MLB7').perf.latest.visits_per_day, null); assert.equal(rowOf(m, 'MLB8').perf.latest.visits_per_day, 10);
  assert.equal(m.reports.comparable.ok, false);
});

// ---- Reversão ----
withDb('reversão: o arquivo de reversão remove só a função e não mexe em mais nada; reaplicar a migração restaura', async (db) => {
  const down = fs.readFileSync(path.join(here, '../../supabase/rollback/20261125120000_commerce_decision_units_v1.down.sql'), 'utf8');
  const objs = async () => (await db.q(`select 'f:'||p.proname n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public'
      union all select 'c:'||c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind in ('r','v','m','S')`)).map((x) => x.n).sort();
  const before = await objs();
  assert.ok(before.includes('f:commerce_decision_units_v1'));
  await db.main.query(down);
  assert.equal((await db.one(`select to_regprocedure('public.commerce_decision_units_v1(text,date,date,date,date,integer)') r`)).r, null);
  assert.deepEqual(await objs(), before.filter((x) => x !== 'f:commerce_decision_units_v1'), 'só a função some');
  await db.main.query(down); // idempotente
  await db.main.query(MIGRATION);
  assert.ok((await objs()).includes('f:commerce_decision_units_v1'));
  assert.equal(typeof (await call(db)).totals.listings, 'number');
});
