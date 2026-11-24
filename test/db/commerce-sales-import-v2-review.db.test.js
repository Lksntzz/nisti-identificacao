// GA-019 — revisão técnica da PR #910: cobertura, Mercado Livre em partes, exclusão, arquivo antigo, financeiro,
// reversão (com v1 e cache) e trava global da v1. Postgres 17 local descartável, dados fictícios. Rodar: npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, stopServer, newDb, stage, stageV1Monthly, commit, commitError, summary, fingerprint, visibleState,
  seedLegacyShopee, OLD_ML_VIEW, MIGRATION } from './harness.mjs';

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

const T = (d) => `${d}T12:00:00-03:00`;
const S = 'SHOPEE';
const withDb = (name, fn) => test(name, async () => {
  const db = await newDb();
  try { await fn(db); } finally { await db.close(); }
});
const day = (sku, units, rev, orders) => ({ sku, units, rev, orders });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fin = (month, ordersN, units, rev) => ({ month, orders: ordersN, units, rev, fee: 1, feeOrders: ordersN, singleSku: ordersN });
const finDay = (date, fee = 1) => ({ date, sku: 'AAA', orders: 1, units: 1, rev: 10, fee });
const activate = async (db, id) => (await db.one('select public.commerce_activate_shopee_finance_v2($1) r', [id])).r;
const rollback = async (db, snap) => (await db.one('select public.commerce_rollback_sales_import_v2($1) r', [snap])).r;
const currentSnap = async (db) => Number((await db.one('select id from commerce_sales_snapshots where is_current')).id);
const viewDay = (db, platform, d) => db.q(`select external_listing_id l, units, product_revenue::float8 rev from commerce_current_sales_listing_daily_v1
  where platform_code = $1 and sale_date = $2 order by 1`, [platform, d]);

async function assertAtomicFailure(db, id, code) {
  const before = await fingerprint(db);
  const e = await commitError(db, id);
  assert.ok(e, 'devia falhar');
  assert.match(e.message, new RegExp(code));
  assert.deepEqual(await fingerprint(db), before, 'nenhuma alteração parcial pode ficar');
}

// ---------- 1. cobertura: dia sem registro nunca vira "dia sem vendas" ----------

withDb('mês sem nenhum dia intermediário mantém só o que foi observado; lacuna é apenas informada', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-09': [day('AAA', 1, 10, ['o9'])] } });
  const r = await commit(db, a);
  assert.equal(r.days_without_records.length, 7, 'dias 02 a 08 sem registro');
  assert.equal(r.days_without_records[0], '2026-10-02');
  assert.equal((await db.one(`select count(*)::int n from commerce_sales_day_coverage_v2 where not has_sales`)).n, 0,
    'nenhum dia é marcado como "sem vendas" por inferência');
});

// ---------- 3. Mercado Livre: dia dividido em partes ----------

const mlParts = async (db) => {
  const p1 = await stage(db, { platform: 'ML_NOVO', file: 'ml_part_1_of_2.xlsx', created: T('2026-11-10'), days: {
    '2026-11-01': [day('MMM', 2, 20, ['m1', 'm2']), day('NNN', 3, 30, ['m3', 'm4', 'm5'])] } });
  assert.equal((await commit(db, p1)).status, 'WAITING_PARTS');
  const p2 = await stage(db, { platform: 'ML_NOVO', file: 'ml_part_2_of_2.xlsx', created: T('2026-11-10'), days: {
    '2026-11-01': [day('MMM', 1, 10, ['m6'])], '2026-11-02': [day('MMM', 1, 10, ['m7'])] } });
  const r = await commit(db, p2);
  assert.equal(r.status, 'COMMITTED'); assert.equal(r.merged_parts, 2);
  return { p1, p2 };
};

withDb('Mercado Livre: dia dividido em partes aparece INTEIRO na view que as telas usam e fecha com o resumo mensal', async (db) => {
  await mlParts(db);
  const d1 = await viewDay(db, 'ML_NOVO', '2026-11-01');
  assert.deepEqual(d1.map((x) => [x.l, x.units]), [['L-MMM', 3], ['L-NNN', 3]], 'MMM das duas partes somado (2+1) e NNN da parte 1');
  const total = (await db.one(`select sum(units)::int u from commerce_current_sales_listing_daily_v1 where platform_code = 'ML_NOVO'`)).u;
  const s = await summary(db, 'ML_NOVO', '2026-11');
  assert.equal(total, 7); assert.equal(s.units, 7, 'diário e mensal batem');
  assert.equal(s.net_orders, 7);
});

withDb('reprodução do defeito: com a view ANTIGA uma das partes do dia some (e a nova conciliação acusa)', async (db) => {
  await mlParts(db);
  await db.q(OLD_ML_VIEW);
  const total = (await db.one(`select sum(units)::int u from commerce_current_sales_listing_daily_v1 where platform_code = 'ML_NOVO'`)).u;
  assert.ok(total < 7, `a view antiga perde vendas (${total} < 7)`);
  const bad = await db.q(`select month_start::text m, ok from commerce_sales_reconcile_v2('ML_NOVO')`);
  assert.deepEqual(bad, [{ m: '2026-11-01', ok: true }], 'a conciliação usa a fonte diária correta, não a view antiga');
});

withDb('conciliação diário x mensal: ok quando bate; aponta o mês quando o resumo foi adulterado', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 2, 20, ['o1', 'o2'])], '2026-10-02': [day('BBB', 1, 10, ['o3'])] } });
  await commit(db, a);
  await mlParts(db);
  const rows = await db.q(`select platform_code p, month_start::text m, ok from commerce_sales_reconcile_v2() order by 1, 2`);
  assert.deepEqual(rows, [{ p: 'ML_NOVO', m: '2026-11-01', ok: true }, { p: 'SHOPEE', m: '2026-10-01', ok: true }]);
  await db.q(`update commerce_sales_summary_rows set units = units - 1 where platform_code = 'SHOPEE'
    and snapshot_id = (select id from commerce_sales_snapshots where is_current)`);
  const after = await db.q(`select platform_code p, ok, summary_units::int su, daily_units::int du from commerce_sales_reconcile_v2('SHOPEE')`);
  assert.deepEqual(after, [{ p: 'SHOPEE', ok: false, su: 2, du: 3 }]);
});

withDb('conciliação dentro do commit: receita do diário diferente das linhas do mês aborta tudo (nada fica pela metade)', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 2, 20, ['o1', 'o2'])] } });
  // mesmas unidades, mas a fonte diária guarda outra receita: o teste de unidades passaria, a conciliação não
  await db.q(`update commerce_shopee_sales_sku_daily_v1 set product_revenue = product_revenue + 5 where batch_id = $1`, [a]);
  await assertAtomicFailure(db, a, 'sales_import_reconciliation_failed');
});

// ---------- 4. exclusão ----------

withDb('excluir lote já processado pela v2 (ou o snapshot dele) é bloqueado e nada muda', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 2, 20, ['o1', 'o2'])] } });
  await commit(db, a);
  const before = await fingerprint(db);
  await assert.rejects(db.q('delete from commerce_sales_import_batches where id = $1', [a]), /sales_import_delete_blocked_v2/);
  await assert.rejects(db.q('delete from commerce_sales_snapshots where id = $1', [await currentSnap(db)]), /sales_import_delete_blocked_v2/);
  assert.deepEqual(await fingerprint(db), before);
  const rec = await db.q('select ok from commerce_sales_reconcile_v2()');
  assert.ok(rec.every((r) => r.ok), 'resumos e fontes diárias continuam consistentes');
});

withDb('lote que ainda não virou venda confirmada pode ser excluído normalmente', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 2, 20, ['o1', 'o2'])] } });
  await db.q('delete from commerce_sales_import_batches where id = $1', [a]);
  assert.equal((await db.one('select count(*)::int n from commerce_sales_import_batches')).n, 0);
});

// ---------- 7. arquivo antigo não substitui dado novo ----------

withDb('arquivo gerado ANTES do que já foi importado não substitui o dia (STALE_FILE); dia novo dele entra', async (db) => {
  const newer = await stage(db, { file: 'novo.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('AAA', 5, 50, ['a1', 'a2', 'a3', 'a4', 'a5'])], '2026-10-02': [day('AAA', 1, 10, ['b1'])] } });
  await commit(db, newer);
  const older = await stage(db, { file: 'antigo.xlsx', created: T('2026-10-25'), generated: T('2026-10-12'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['a1'])], '2026-10-03': [day('AAA', 2, 20, ['c1', 'c2'])] } });
  const r = await commit(db, older);
  assert.deepEqual(r.kept_days, [{ date: '2026-10-01', reason: 'STALE_FILE' }]);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 8, 'dia 1 (5, do arquivo novo) + dia 2 (1) + dia 3 (2, só o antigo tinha)');
  assert.equal((await db.one(`select count(*)::int n from commerce_shopee_sales_sku_daily_v1 where batch_id = $1 and sale_date = '2026-10-01'`, [older])).n, 0);
});

withDb('relatório antigo contra dia que veio de importação legada (sem data de geração) também é barrado', async (db) => {
  await seedLegacyShopee(db, { month: '2026-10', through: '2026-10-03', blockOrders: 3, committedAt: T('2026-10-20'),
    days: { '2026-10-03': [day('AAA', 3, 30, ['x1', 'x2', 'x3'])] } });
  const f = await stage(db, { file: 'antigo.xlsx', created: T('2026-10-25'), generated: T('2026-10-10'), days: { '2026-10-03': [day('AAA', 1, 10, ['x1'])] } });
  const r = await commit(db, f);
  assert.deepEqual(r.kept_days, [{ date: '2026-10-03', reason: 'STALE_FILE' }]);
});

withDb('reimportar o MESMO arquivo (mesma data de geração) continua permitido e idempotente', async (db) => {
  const mk = () => ({ file: 'a.xlsx', created: T('2026-10-20'), generated: T('2026-10-18'), days: { '2026-10-01': [day('AAA', 2, 20, ['o1', 'o2'])] } });
  await commit(db, await stage(db, mk()));
  const before = await summary(db, S, '2026-10');
  const r = await commit(db, await stage(db, { ...mk(), created: T('2026-10-22') }));
  assert.deepEqual(r.kept_days, []);
  assert.deepEqual(await summary(db, S, '2026-10'), before);
});

withDb('sem data de geração do arquivo o commit é recusado e nada muda', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), generated: null, days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  await assertAtomicFailure(db, a, 'sales_import_generated_at_required');
});

withDb('data de geração informada no futuro é limitada ao momento do envio; arquivo gerado antes do dia terminar tem o último dia parcial', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), generated: '2026-12-31T00:00:00-03:00', days: { '2026-10-09': [day('AAA', 1, 10, ['o1'])], '2026-10-10': [day('AAA', 1, 10, ['o2'])] } });
  const r = await commit(db, a);
  assert.equal(r.coverage.final_through, '2026-10-09', 'a data futura não torna o dia 10 completo');
});

withDb('arquivo exportado no próprio dia e enviado dias depois continua parcial (vale a geração, não o envio)', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-22'), generated: T('2026-10-05'), days: {
    '2026-10-04': [day('AAA', 1, 10, ['o1'])], '2026-10-05': [day('AAA', 1, 10, ['o2'])] } });
  const r = await commit(db, a);
  assert.equal(r.coverage.final_through, '2026-10-04');
});

withDb('commerce_set_sales_import_meta_v2 valida entrada e lote aberto', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  await assert.rejects(db.q('select public.commerce_set_sales_import_meta_v2($1, null)', [a]), /sales_import_generated_at_required/);
  await assert.rejects(db.q('select public.commerce_set_sales_import_meta_v2(99999, now())'), /sales_import_batch_not_found/);
  await commit(db, a);
  await assert.rejects(db.q('select public.commerce_set_sales_import_meta_v2($1, now())', [a]), /sales_import_batch_closed/);
});

// ---------- 9. trava global também na v1 ----------

withDb('a v1 também espera a trava global e continua funcionando; migração reaplicada não duplica a trava', async (db) => {
  const def = (await db.one(`select pg_get_functiondef('public.commerce_commit_sales_import_v1(bigint)'::regprocedure) d`)).d;
  assert.equal((def.match(/pg_advisory_xact_lock/g) || []).length, 1, 'v1 patched com a trava global (uma vez)');
  await db.q(fs.readFileSync(MIGRATION, 'utf8')); // idempotente
  const def2 = (await db.one(`select pg_get_functiondef('public.commerce_commit_sales_import_v1(bigint)'::regprocedure) d`)).d;
  assert.equal((def2.match(/pg_advisory_xact_lock/g) || []).length, 1);
  assert.equal((await db.one(`select has_function_privilege('anon', 'public.commerce_commit_sales_import_v1(bigint)', 'execute') ok`)).ok, false);
  assert.equal((await db.one(`select has_function_privilege('service_role', 'public.commerce_commit_sales_import_v1(bigint)', 'execute') ok`)).ok, true);

  const id = await stageV1Monthly(db, { file: 'Order.all.mensal.xlsx', created: T('2026-10-10'), month: '2026-10', through: '2026-10-05',
    rows: [{ sku: 'AAA', units: 2, rev: 20, owi: 2 }], netOrders: 2 });
  const c1 = await db.client(); const c2 = await db.client();
  await c1.query('begin');
  await c1.query(`select pg_advisory_xact_lock(hashtextextended('commerce_sales_commit', 2026))`);
  let done = false;
  const p = c2.query('select public.commerce_commit_sales_import_v1($1) r', [id]).then((r) => { done = true; return r; });
  await sleep(700);
  assert.equal(done, false, 'a v1 espera quem está commitando pela v2');
  await c1.query('commit');
  assert.equal((await p).rows[0].r.status, 'COMMITTED');
});

// ---------- 6. reversão: resumos, fontes diárias, cache e compatibilidade com a v1 ----------

const seedFull = (db, batch, d) => db.q(`insert into commerce_shopee_full_daily_v1(batch_id, sale_date, sku_norm, units, product_revenue) values ($1,$2,'AAA',1,10)`, [batch, d]);

withDb('reverter o último commit restaura resumos, dias substituídos, Full e cache; a v1 volta a funcionar', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('AAA', 2, 20, ['o1', 'o2'])], '2026-10-02': [day('AAA', 1, 10, ['o3'])], '2026-10-03': [day('BBB', 1, 10, ['o4'])] } });
  await commit(db, a);
  await seedFull(db, a, '2026-10-03');
  await db.q(`insert into commerce_shopee_order_extras_daily_v1(batch_id, sale_date, sku_norm, units) values ($1,'2026-10-03','BBB',1)`, [a]);
  const state0 = await visibleState(db);
  const snapA = await currentSnap(db);

  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-25'), days: {
    '2026-10-03': [day('BBB', 4, 40, ['p1', 'p2', 'p3', 'p4'])], '2026-10-04': [day('AAA', 1, 10, ['p5'])] } });
  const rb = await commit(db, b);
  const snapB = rb.snapshot_id;
  const state1 = await visibleState(db);
  assert.notDeepEqual(state1, state0);
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_sku_daily_superseded_v1')).n, 1, 'o dia 3 antigo foi guardado');
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_full_daily_v1')).n, 0, 'o gatilho apagou o Full do dia 3 sem cópia');
  const v1After = (await db.one('select public.commerce_data_version_v1() v')).v;
  await db.q(`insert into commerce_read_cache_v1(cache_key, data_version, payload) values ('k', $1, '{}')`, [v1After]);

  const out = await rollback(db, snapB);
  assert.equal(out.status, 'ROLLED_BACK'); assert.equal(out.restored_snapshot_id, snapA);
  assert.deepEqual(await visibleState(db), state0, 'resumos, fontes diárias, Full e extras idênticos ao estado anterior ao commit');
  assert.equal((await db.one('select count(*)::int n from commerce_read_cache_v1')).n, 0, 'cache limpo');
  assert.notEqual((await db.one('select public.commerce_data_version_v1() v')).v, v1After, 'versão do cache mudou');
  assert.equal((await db.one(`select status from commerce_sales_import_batches where id = $1`, [b])).status, 'FAILED');
  const rec = await db.q('select ok from commerce_sales_reconcile_v2()');
  assert.ok(rec.every((r) => r.ok));
  // reverter duas vezes não é possível
  await assert.rejects(db.q('select public.commerce_rollback_sales_import_v2($1)', [snapB]), /sales_import_rollback_not_current/);

  // compatibilidade: com o código antigo (v1) o sistema segue importando
  const v1 = await stageV1Monthly(db, { file: 'Order.all.mensal.xlsx', created: T('2026-11-05'), month: '2026-11', through: '2026-11-03',
    rows: [{ sku: 'CCC', units: 3, rev: 30, owi: 3 }], netOrders: 3 });
  assert.equal((await db.one('select public.commerce_commit_sales_import_v1($1) r', [v1])).r.status, 'COMMITTED');
  assert.equal((await summary(db, S, '2026-10')).units, 4, 'outubro continua como estava antes do commit revertido');
  assert.equal((await summary(db, S, '2026-11')).units, 3);
});

withDb('só o commit mais recente (de um snapshot da v2) pode ser revertido', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  const ra = await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-21'), days: { '2026-10-02': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, b);
  const before = await fingerprint(db);
  await assert.rejects(db.q('select public.commerce_rollback_sales_import_v2($1)', [ra.snapshot_id]), /sales_import_rollback_not_current/);
  await assert.rejects(db.q('select public.commerce_rollback_sales_import_v2(424242)'), /sales_import_rollback_unknown_snapshot/);
  assert.deepEqual(await fingerprint(db), before);
});

withDb('reverter restaura também o financeiro Shopee (mês e dia) e remove o que o commit criou', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-11-10'), days: { '2026-11-01': [day('AAA', 1, 10, ['o1'])], '2026-11-02': [day('AAA', 1, 10, ['o2'])] },
    finance: { days: [finDay('2026-11-01'), finDay('2026-11-02')], months: [fin('2026-11-01', 2, 2, 20)] } });
  await commit(db, a); await activate(db, a);
  const state0 = await visibleState(db);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-11-12'), days: { '2026-11-02': [day('AAA', 1, 10, ['o2b'])], '2026-11-03': [day('AAA', 1, 10, ['o3'])] },
    finance: { days: [finDay('2026-11-02', 5), finDay('2026-11-03')], months: [fin('2026-11-01', 2, 2, 20)] } });
  const rb = await commit(db, b); await activate(db, b);
  assert.notDeepEqual(await visibleState(db), state0);
  await rollback(db, rb.snapshot_id);
  assert.deepEqual(await visibleState(db), state0, 'dia 2 volta ao valor anterior e o dia 3 criado pelo commit some');
});

withDb('a ativação financeira guarda cópia do que sobrescreve (dia e mês)', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-11-10'), days: { '2026-11-01': [day('AAA', 1, 10, ['o1'])], '2026-11-02': [day('AAA', 1, 10, ['o2'])] },
    finance: { days: [finDay('2026-11-01'), finDay('2026-11-02')], months: [fin('2026-11-01', 2, 2, 20)] } });
  await commit(db, a); await activate(db, a);
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_finance_month_bak_v2 where existed')).n, 0, 'primeira ativação: nada existia antes');
  const c = await stage(db, { file: 'c.xlsx', created: T('2026-11-14'), days: { '2026-11-01': [day('AAA', 1, 10, ['o1'])], '2026-11-02': [day('AAA', 1, 10, ['o2'])] },
    finance: { days: [finDay('2026-11-01', 7), finDay('2026-11-02', 7)], months: [fin('2026-11-01', 2, 2, 20)] } });
  const rc = await commit(db, c);
  const r = await activate(db, c);
  assert.deepEqual(r.finance_months_published, ['2026-11-01']);
  const mb = await db.q('select month_start::text m, existed, (previous->>\'source_snapshot_id\')::int prev from commerce_shopee_finance_month_bak_v2 where snapshot_id = $1', [rc.snapshot_id]);
  assert.equal(mb.length, 1); assert.equal(mb[0].existed, true); assert.ok(mb[0].prev > 0);
  const db2 = await db.q('select sale_date::text d, existed, (previous->>\'commission_net\')::numeric::float8 fee from commerce_shopee_finance_daily_bak_v2 where snapshot_id = $1 order by 1', [rc.snapshot_id]);
  assert.deepEqual(db2.map((x) => [x.d, x.existed, x.fee]), [['2026-11-01', true, 1], ['2026-11-02', true, 1]]);
});

// ---------- 5. financeiro mensal: o que a regra nova faz com o mês ----------

withDb('financeiro mensal: importação incremental esconde o mês da tela (sem apagar nada) e a visão de visibilidade explica o motivo', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-11-10'), days: { '2026-11-01': [day('AAA', 1, 10, ['o1'])], '2026-11-02': [day('AAA', 1, 10, ['o2'])] },
    finance: { days: [finDay('2026-11-01'), finDay('2026-11-02')], months: [fin('2026-11-01', 2, 2, 20)] } });
  await commit(db, a); await activate(db, a);
  let v = await db.one(`select visible, reason from commerce_shopee_finance_month_visibility_v2 where month_start = '2026-11-01'`);
  assert.deepEqual(v, { visible: true, reason: 'VISIBLE' });
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-11-12'), days: { '2026-11-03': [day('AAA', 1, 10, ['o3'])] },
    finance: { days: [finDay('2026-11-03')], months: [fin('2026-11-01', 1, 1, 10)] } });
  await commit(db, b); await activate(db, b);
  v = await db.one(`select visible, reason from commerce_shopee_finance_month_visibility_v2 where month_start = '2026-11-01'`);
  assert.deepEqual(v, { visible: false, reason: 'NEWER_IMPORT_TOUCHED_MONTH' });
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_finance_current_month_v1')).n, 0, 'a tela deixa de mostrar o mês (comportamento já existente da view)');
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_finance_month_v1')).n, 1, 'mas o dado do mês continua guardado');
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_finance_daily_v1')).n, 3, 'e o financeiro por dia está completo');
  // reexportar o mês inteiro traz o indicador de volta
  const c = await stage(db, { file: 'c.xlsx', created: T('2026-11-15'), days: { '2026-11-01': [day('AAA', 1, 10, ['o1'])], '2026-11-02': [day('AAA', 1, 10, ['o2'])], '2026-11-03': [day('AAA', 1, 10, ['o3'])] },
    finance: { days: [finDay('2026-11-01'), finDay('2026-11-02'), finDay('2026-11-03')], months: [fin('2026-11-01', 3, 3, 30)] } });
  await commit(db, c); await activate(db, c);
  v = await db.one(`select visible, reason from commerce_shopee_finance_month_visibility_v2 where month_start = '2026-11-01'`);
  assert.deepEqual(v, { visible: true, reason: 'VISIBLE' });
});

// ---------- permissões das peças novas ----------

withDb('peças novas: só service_role executa/lê; RLS ligada', async (db) => {
  const fns = ['commerce_set_sales_import_meta_v2(bigint,timestamptz)', 'commerce_rollback_sales_import_v2(bigint)', 'commerce_sales_reconcile_v2(text)'];
  for (const f of fns) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.one(`select has_function_privilege($1, 'public.${f}', 'execute') ok`, [role])).ok, false, `${role} não executa ${f}`);
    }
    assert.equal((await db.one(`select has_function_privilege('service_role', 'public.${f}', 'execute') ok`)).ok, true);
    assert.equal((await db.one(`select count(*)::int n from information_schema.routine_privileges where specific_schema = 'public'
      and routine_name = $1 and grantee = 'PUBLIC'`, [f.split('(')[0]])).n, 0);
  }
  for (const t of ['commerce_sales_import_meta_v2', 'commerce_sales_commit_log_v2', 'commerce_shopee_finance_month_bak_v2',
    'commerce_shopee_finance_daily_bak_v2', 'commerce_shopee_full_daily_bak_v2']) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.one(`select has_table_privilege($1, 'public.${t}', 'select') ok`, [role])).ok, false, `${role} não lê ${t}`);
    }
    assert.equal((await db.one(`select has_table_privilege('service_role', 'public.${t}', 'select') ok`)).ok, true);
    assert.equal((await db.one(`select relrowsecurity ok from pg_class where relname = $1`, [t])).ok, true, `RLS em ${t}`);
  }
  assert.equal((await db.one(`select has_table_privilege('anon', 'public.commerce_shopee_finance_month_visibility_v2', 'select') ok`)).ok, false);
});
