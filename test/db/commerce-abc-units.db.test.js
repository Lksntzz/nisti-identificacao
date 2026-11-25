// GA-015 — commerce_abc_units_monthly_v1 num Postgres local descartável, só com dados FICTÍCIOS.
// A migração é só um ARQUIVO nesta etapa: aqui ela roda no banco de teste, nunca no Supabase.
// A tabela de apelidos do harness tem outro formato; aqui ela é recriada com as colunas reais (old_sku/new_sku).
// As duas fontes (por SKU da Shopee e por anúncio do ML) viram tabelas fictícias SEM coluna de receita:
// se a função tentasse ler receita, o teste quebraria.
// Rodar: npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer, newDb } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.join(here, '../../supabase/migrations/20261125160000_commerce_abc_units_monthly_v1.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(here, '../../supabase/rollback/20261125160000_commerce_abc_units_monthly_v1.down.sql'), 'utf8');
const FN = 'public.commerce_abc_units_monthly_v1(text,jsonb)';

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

const DEPS = `
drop table if exists public.commerce_sku_alias_v1 cascade;
create table public.commerce_sku_alias_v1 (old_sku text primary key, new_sku text not null);
create or replace function public.commerce_sku_canon_v1(p_sku text) returns text language sql stable set search_path to 'public' as $f$
  select coalesce((select a.new_sku from public.commerce_sku_alias_v1 a where a.old_sku=upper(regexp_replace(p_sku,'[\\s_]+','','g'))), upper(regexp_replace(p_sku,'[\\s_]+','','g')));
$f$;
create table public.fx_sku (sale_date date, sku_norm text, units integer);
create table public.fx_listing (platform_code text, sale_date date, external_listing_id text, sku_norm text, units integer);
drop view if exists public.commerce_shopee_current_sku_daily_v1 cascade;
create view public.commerce_shopee_current_sku_daily_v1 as select sale_date, sku_norm, units from public.fx_sku;
drop view if exists public.commerce_current_sales_listing_daily_v1 cascade;
create view public.commerce_current_sales_listing_daily_v1 as select platform_code, sale_date, external_listing_id, sku_norm, units from public.fx_listing;
grant select on public.commerce_shopee_current_sku_daily_v1, public.commerce_current_sales_listing_daily_v1 to service_role;
grant select on public.commerce_sku_alias_v1 to service_role;
`;

function withDb(name, fn) {
  test(name, async () => {
    const db = await newDb();
    try { await db.main.query(DEPS); await db.main.query(MIGRATION); await fn(db); } finally { await db.close(); }
  });
}
const P = (key, start, end) => ({ key, start, end });
const OUT = P('2026-10', '2026-10-01', '2026-10-31'), NOV = P('2026-11', '2026-11-01', '2026-11-23');
const call = (db, plat, periods) => db.one(`select public.commerce_abc_units_monthly_v1($1,$2::jsonb) r`, [plat, JSON.stringify(periods)]).then((x) => x.r);
const sku = (db, day, s, u) => db.q(`insert into fx_sku values ($1,$2,$3)`, [day, s, u]);
const lst = (db, plat, day, ext, s, u) => db.q(`insert into fx_listing values ($1,$2,$3,$4,$5)`, [plat, day, ext, s, u]);
const prod = (r, s) => r.products.find((x) => x.sku === s);
const per = (r, k) => r.periods.find((x) => x.key === k);

withDb('Shopee: unidades por SKU em cada período, ordenadas pelo volume, com totais por período', async (db) => {
  await sku(db, '2026-10-05', 'AAA', 10); await sku(db, '2026-10-20', 'BBB', 3); await sku(db, '2026-11-02', 'AAA', 4); await sku(db, '2026-11-24', 'AAA', 99);
  const r = await call(db, 'SHOPEE', [OUT, NOV]);
  assert.equal(r.source, 'SKU_SHOPEE'); assert.deepEqual(r.products.map((x) => x.sku), ['AAA', 'BBB']);
  assert.deepEqual(prod(r, 'AAA').units, { '2026-10': 10, '2026-11': 4 }); assert.deepEqual(prod(r, 'BBB').units, { '2026-10': 3 });
  assert.equal(per(r, '2026-10').total_units, 13); assert.equal(per(r, '2026-11').total_units, 4, 'dia fora do período não entra');
  assert.equal(per(r, '2026-10').products, 2); assert.equal(per(r, '2026-10').days, 31); assert.equal(per(r, '2026-10').days_with_data, 2);
  assert.equal(r.product_count, 2);
});

withDb('intervalos que atravessam meses: janela de 7 e de 30 dias somam os dois meses', async (db) => {
  await sku(db, '2026-10-28', 'AAA', 2); await sku(db, '2026-11-01', 'AAA', 5); await sku(db, '2026-11-03', 'AAA', 1); await sku(db, '2026-10-27', 'AAA', 100);
  const r = await call(db, 'SHOPEE', [P('w7', '2026-10-28', '2026-11-03'), P('w30', '2026-10-05', '2026-11-03')]);
  assert.equal(prod(r, 'AAA').units.w7, 8); assert.equal(prod(r, 'AAA').units.w30, 108); assert.equal(per(r, 'w7').days, 7); assert.equal(per(r, 'w30').days, 30);
});

withDb('SEM SKU: fica no total do período e FORA da lista de produtos', async (db) => {
  await sku(db, '2026-10-05', 'AAA', 10); await sku(db, '2026-10-06', null, 7); await sku(db, '2026-10-07', '   ', 2);
  const r = await call(db, 'SHOPEE', [OUT]);
  assert.deepEqual(r.products.map((x) => x.sku), ['AAA']);
  const p = per(r, '2026-10'); assert.equal(p.total_units, 19); assert.equal(p.sku_units, 10); assert.equal(p.no_sku_units, 9); assert.equal(p.ranked_units, 10);
  assert.ok(!r.products.some((x) => /SEM/i.test(x.sku)));
});

withDb('SKUs com apelido revisado viram o mesmo produto canônico; espaços e caixa não separam', async (db) => {
  await db.q(`insert into commerce_sku_alias_v1 values ('OLD1','NEW1')`);
  await sku(db, '2026-10-05', 'old1', 4); await sku(db, '2026-10-06', 'NEW1', 6); await sku(db, '2026-10-07', 'new_1', 1);
  const r = await call(db, 'SHOPEE', [OUT]);
  assert.deepEqual(r.products.map((x) => x.sku), ['NEW1']); assert.equal(prod(r, 'NEW1').units['2026-10'], 11);
});

withDb('ML: só a conta pedida; Shopee não mistura; ML sem SKU entra só no total', async (db) => {
  await lst(db, 'ML_ANTIGO', '2026-10-05', 'MLB1', 'AAA', 5); await lst(db, 'ML_NOVO', '2026-10-05', 'MLB1', 'AAA', 9);
  await lst(db, 'ML_ANTIGO', '2026-10-06', 'MLB2', null, 3); await lst(db, 'ML_ANTIGO', '2026-10-06', 'MLB3', 'AAA', 2);
  await sku(db, '2026-10-05', 'AAA', 1000);
  const a = await call(db, 'ML_ANTIGO', [OUT]); const n = await call(db, 'ML_NOVO', [OUT]);
  assert.equal(a.source, 'ANUNCIOS_ML'); assert.equal(prod(a, 'AAA').units['2026-10'], 7); assert.equal(per(a, '2026-10').no_sku_units, 3); assert.equal(per(a, '2026-10').total_units, 10);
  assert.equal(prod(n, 'AAA').units['2026-10'], 9); assert.equal(per(n, '2026-10').total_units, 9);
});

withDb('soma não positiva (devolução) sai da lista mas fica nos totais e é informada', async (db) => {
  await sku(db, '2026-10-05', 'AAA', 5); await sku(db, '2026-10-06', 'NEG', 2); await sku(db, '2026-10-07', 'NEG', -3);
  const r = await call(db, 'SHOPEE', [OUT]);
  assert.deepEqual(r.products.map((x) => x.sku), ['AAA']); const p = per(r, '2026-10');
  assert.equal(p.sku_units, 4); assert.equal(p.ranked_units, 5); assert.equal(p.nonpositive_units, -1); assert.equal(p.total_units, 4);
});

withDb('período sem vendas continua na resposta com zeros (não some nem vira classe)', async (db) => {
  await sku(db, '2026-10-05', 'AAA', 5);
  const r = await call(db, 'SHOPEE', [OUT, P('2026-09', '2026-09-01', '2026-09-30')]);
  const s = per(r, '2026-09'); assert.equal(s.total_units, 0); assert.equal(s.days_with_data, 0); assert.equal(s.products, 0); assert.deepEqual(r.periods.map((x) => x.key), ['2026-10', '2026-09'], 'ordem pedida');
});

withDb('validações: conta, lista, quantidade, datas, tamanho, chaves repetidas e formato', async (db) => {
  const bad = async (plat, periods, re) => assert.rejects(() => call(db, plat, periods), re);
  await bad('TODAS', [OUT], /plataforma inválida/); await bad(null, [OUT], /plataforma inválida/); await bad('SHOPEE', [], /entre 1 e 24/);
  await bad('SHOPEE', Array.from({ length: 25 }, (_, i) => P('k' + i, '2026-10-01', '2026-10-02')), /entre 1 e 24/);
  await bad('SHOPEE', [P('a', '2026-10-05', '2026-10-01')], /inválidos/); await bad('SHOPEE', [P('a', '2026-01-01', '2026-06-30')], /inválidos/);
  await bad('SHOPEE', [OUT, OUT], /repetidas/); await bad('SHOPEE', [P('a', '2026-13-45', '2026-13-46')], /inválidos/); await bad('SHOPEE', [P('a b', '2026-10-01', '2026-10-02')], /inválidos/);
  await bad('SHOPEE', [{ key: 'a', start: '2026-10-01' }], /inválidos/); await bad('SHOPEE', ['x'], /inválidos/);
  await assert.rejects(() => db.one(`select public.commerce_abc_units_monthly_v1('SHOPEE','{"a":1}'::jsonb)`), /lista/);
  assert.ok(await call(db, 'SHOPEE', [P('a', '2026-10-01', '2026-10-01')]), 'um dia é válido');
  assert.ok(await call(db, 'SHOPEE', [P('a', '2026-08-01', '2026-11-01')]), '93 dias é válido');
});

withDb('somente leitura e sem receita: roda em transação read only, é STABLE, INVOKER, search_path explícito, só service_role executa', async (db) => {
  await sku(db, '2026-10-05', 'AAA', 5);
  await db.main.query('begin read only');
  const r = await call(db, 'SHOPEE', [OUT]);
  await db.main.query('rollback');
  assert.ok(!/revenue|receita|ticket|margin|profit|price/i.test(JSON.stringify(r)));
  const f = await db.one(`select p.provolatile v, p.prosecdef sd, p.proconfig cfg, p.proacl::text acl from pg_proc p where p.oid = '${FN}'::regprocedure`);
  assert.equal(f.v, 's'); assert.equal(f.sd, false); assert.ok(f.cfg.some((c) => /^search_path=public, pg_temp$/.test(c)), String(f.cfg));
  assert.ok(f.acl.includes('service_role=X')); assert.ok(!f.acl.includes('anon=') && !f.acl.includes('authenticated=') && !/^=X|,=X/.test(f.acl), f.acl);
  for (const role of ['anon', 'authenticated']) assert.equal((await db.one(`select has_function_privilege('${role}', '${FN}', 'execute') ok`)).ok, false, role);
  await db.main.query('set role anon'); await assert.rejects(() => call(db, 'SHOPEE', [OUT]), /permission denied/); await db.main.query('reset role');
  await db.main.query('set role service_role'); assert.ok(await call(db, 'SHOPEE', [OUT])); await db.main.query('reset role');
  const body = MIGRATION.replace(/--.*$/gm, '').split('$fn$')[1];
  assert.ok(!/\b(insert|update|delete|truncate)\b|create (temporary )?table/i.test(body), 'o corpo não escreve nem cria tabela');
  assert.ok(!/product_revenue|receita/i.test(body), 'a coluna de receita nunca é lida');
});

withDb('reversão remove só a função e não toca dados nem outras funções', async (db) => {
  await sku(db, '2026-10-05', 'AAA', 5);
  const before = await db.one(`select (select count(*) from fx_sku)::int n, (select count(*) from pg_proc where proname='commerce_sku_canon_v1')::int c`);
  await db.main.query(ROLLBACK);
  assert.equal((await db.one(`select count(*)::int n from pg_proc where proname='commerce_abc_units_monthly_v1'`)).n, 0);
  assert.deepEqual(await db.one(`select (select count(*) from fx_sku)::int n, (select count(*) from pg_proc where proname='commerce_sku_canon_v1')::int c`), before);
  await db.main.query(MIGRATION); assert.ok(await call(db, 'SHOPEE', [OUT]), 'a migração pode ser reaplicada');
});

withDb('desempenho: 600 SKUs x 120 dias, 12 períodos mensais', async (db) => {
  await db.q(`insert into fx_sku select d::date, 'S'||g, 1+(g%7) from generate_series(1,600) g, generate_series(date '2026-01-01', date '2026-04-30', interval '1 day') d`);
  const periods = [1, 2, 3, 4].map((m) => P('2026-0' + m, `2026-0${m}-01`, `2026-0${m}-28`));
  const t0 = Date.now(); const r = await call(db, 'SHOPEE', periods); const ms = Date.now() - t0;
  assert.equal(r.product_count, 600); assert.ok(ms < 3000, `demorou ${ms} ms`);
});
