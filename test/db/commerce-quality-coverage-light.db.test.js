// GA-P02D — migração REAL da função leve de cobertura, testada neste Postgres local descartável (dados fictícios; nada em produção).
// Prova: platform, period e todos os campos de cobertura de sales são IDÊNTICOS aos de commerce_data_quality_v1, e os critérios JS de cobertura
// (coverageProven) dão o mesmo resultado nas duas saídas. A conciliação GA-011 NÃO é chamada pela função leve.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, stopServer, newDb, stage, commit, seedLegacyShopee } from './harness.mjs';
import { coverageProven } from '../../src/ga/commerce-platform-scope-logic.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(path.join(here, '../../supabase/migrations/20261124140000_commerce_data_quality_v1.sql'), 'utf8');
const LIGHT = fs.readFileSync(path.join(here, '../../supabase/migrations/20261127140000_commerce_data_quality_coverage_v1.sql'), 'utf8');
const EXTRA = fs.readFileSync(path.join(here, 'commerce-data-quality.db.test.js'), 'utf8').match(/const EXTRA = `([\s\S]*?)`;/)[1];

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

const iso = (off) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + off); return d.toISOString().slice(0, 10); };
const T = (d) => `${d}T12:00:00-03:00`;
const day = (sku, units, rev, orders) => ({ sku, units, rev, orders });
const COV_KEYS = ['requested_days', 'complete_days', 'partial_days', 'days_with_records_unverified', 'days_without_information', 'missing_ranges', 'status', 'note'];

async function mkDb() {
  const db = await newDb();
  await db.main.query(EXTRA); await db.main.query(MIGRATION); await db.main.query(LIGHT);
  // Shopee: dias contínuos com buracos, lote gerado ontem (dia de ontem fica parcial) + um lote do dia
  const days = {};
  for (let k = 60; k >= 2; k--) if (k % 7 !== 0 && k % 11 !== 0) days[iso(-k)] = [day('AAA', 1 + (k % 4), 10 + k, ['o' + k])];
  await commit(db, await stage(db, { file: 's1.xlsx', created: T(iso(-1)), days }));
  await commit(db, await stage(db, { file: 's2.xlsx', created: T(iso(0)), days: { [iso(-1)]: [day('BBB', 2, 20, ['p1'])], [iso(0)]: [day('BBB', 1, 9, ['p2'])] } }));
  // histórico legado (COM_REGISTROS): mês antigo só com resumo
  const old = iso(-130).slice(0, 7);
  await seedLegacyShopee(db, { month: old, through: old + '-10', days: { [old + '-02']: [day('ZZZ', 1, 5, ['x1'])], [old + '-03']: [day('ZZZ', 2, 9, ['x2'])] }, blockOrders: 3, committedAt: T(iso(-120)) });
  await commit(db, await stage(db, { platform: 'ML_ANTIGO', file: 'm1.xlsx', created: T(iso(-1)), days: { [iso(-5)]: [day('MMM', 3, 30, ['q1'])], [iso(-4)]: [day('MMM', 1, 10, ['q2'])], [iso(-20)]: [day('MMM', 1, 10, ['q3'])] } }));
  await stage(db, { platform: 'ML_NOVO', file: 'aberto.xlsx', created: T(iso(-1)), days: { [iso(-3)]: [day('NNN', 1, 5, ['r1'])] } });
  await db.main.query('vacuum analyze');
  return db;
}
const call = async (db, fn, args) => {
  try { return { ok: true, r: (await db.one(`select public.${fn}($1,$2::date,$3::date${fn.includes('_v1') && fn.endsWith('quality_v1') ? ',false' : ''}) r`, args)).r }; }
  catch (e) { return { ok: false, err: String(e.message).replace(/^.*?: /, '') }; }
};

test('GA-P02D: função leve devolve platform, period e a cobertura IDÊNTICOS aos da função completa, e os critérios JS concordam', async () => {
  const db = await mkDb();
  try {
    const wins = [];
    for (const plat of ['SHOPEE', 'ML_ANTIGO', 'ML_NOVO', 'shopee'])
      for (const [s, e] of [[null, null], [iso(-30), iso(-2)], [iso(-7), iso(-2)], [iso(-90), null], [iso(-400), null], [iso(-1000), iso(-2)], [iso(-130), iso(-100)], [iso(-3), iso(-3)],
        [iso(-60), iso(-2)], [iso(-14), iso(0)], [iso(0), iso(0)], [iso(-1100), null], [iso(-1101), null], [iso(-2), iso(-5)], [iso(-30), iso(5)]]) wins.push([plat, s, e]);
    wins.push(['AMAZON', null, null], [null, null, null]);
    let proven = 0, unproven = 0, errors = 0;
    for (const [plat, s, e] of wins) {
      const f = await call(db, 'commerce_data_quality_v1', [plat, s, e]), l = await call(db, 'commerce_data_quality_coverage_v1', [plat, s, e]);
      assert.equal(l.ok, f.ok, `${plat} ${s} ${e}: ambas respondem ou ambas recusam`);
      if (!f.ok) { assert.equal(l.err, f.err, 'mesma mensagem de recusa'); errors++; continue; }
      assert.equal(l.r.platform, f.r.platform); assert.deepEqual(l.r.period, f.r.period);
      for (const k of COV_KEYS) assert.deepEqual(l.r.sales[k], f.r.sales[k], `${plat} ${s} ${e}: sales.${k}`);
      assert.deepEqual(Object.keys(l.r.sales).sort(), [...COV_KEYS].sort(), 'a leve só devolve campos de cobertura');
      const per = { start: f.r.period.start, end: f.r.period.end }, P = f.r.platform;
      for (const asked of [per, { start: per.start, end: iso(-1) }]) {
        assert.equal(coverageProven(l.r, P, asked), coverageProven(f.r, P, asked), 'coverageProven igual');
      }
      if (coverageProven(l.r, P, per)) proven++; else unproven++;
    }
    assert.ok(proven >= 1 && unproven >= 10 && errors >= 4, `cobertura variada: ${proven}/${unproven}/${errors}`);
  } finally { await db.close(); }
});

test('GA-P02D: a função leve NÃO chama a conciliação GA-011 (a completa chama)', async () => {
  const db = await mkDb();
  try {
    await db.main.query(`create or replace function public.commerce_shopee_reconciliation_v1(p_start date, p_end date, p_limit integer) returns jsonb language plpgsql as $$ begin raise exception 'conciliacao_chamada'; end $$;`);
    const l = await call(db, 'commerce_data_quality_coverage_v1', ['SHOPEE', iso(-30), iso(-2)]);
    assert.equal(l.ok, true);
    const f = await call(db, 'commerce_data_quality_v1', ['SHOPEE', iso(-30), iso(-2)]);
    assert.equal(f.ok, false); assert.match(f.err, /conciliacao_chamada/);
    const p = await db.one(`select prosecdef, proconfig::text cfg from pg_proc where proname='commerce_data_quality_coverage_v1'`);
    assert.equal(p.prosecdef, false); assert.match(p.cfg, /search_path=public/);
  } finally { await db.close(); }
});

test('GA-P02D: permissões só do service_role; rollback remove só a leve e preserva a função completa', async () => {
  const db = await mkDb();
  try {
    const F = 'public.commerce_data_quality_coverage_v1(text,date,date)';
    const p = await db.one(`select has_function_privilege('anon','${F}','execute') a, has_function_privilege('authenticated','${F}','execute') u,
      has_function_privilege('service_role','${F}','execute') s, has_function_privilege('public','${F}','execute') p`);
    assert.deepEqual([p.a, p.u, p.s, p.p], [false, false, true, false]);
    const before = (await db.one(`select public.commerce_data_quality_v1('SHOPEE',$1::date,$2::date,false)::jsonb - 'generated_at' r`, [iso(-30), iso(-2)])).r;
    await db.main.query(fs.readFileSync(path.join(here, '../../supabase/rollback/20261127140000_commerce_data_quality_coverage_v1.down.sql'), 'utf8'));
    assert.equal((await db.one(`select count(*)::int n from pg_proc where proname='commerce_data_quality_coverage_v1'`)).n, 0);
    const after = (await db.one(`select public.commerce_data_quality_v1('SHOPEE',$1::date,$2::date,false)::jsonb - 'generated_at' r`, [iso(-30), iso(-2)])).r;
    assert.deepEqual(after, before, 'a função completa não muda');
  } finally { await db.close(); }
});
