// GA-019 — comportamento REAL da commerce_commit_sales_import_v2 num Postgres 17 local descartável, com dados fictícios.
// Rodar: npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, stopServer, newDb, stage, commit, commitError, summary, rowsOf, fingerprint, seedLegacyShopee, orderKey } from './harness.mjs';

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

const T = (d) => `${d}T12:00:00-03:00`; // instante de criação do arquivo (horário de Brasília)
const S = 'SHOPEE';
const withDb = (name, fn) => test(name, async () => {
  const db = await newDb();
  try { await fn(db); } finally { await db.close(); }
});
const day = (sku, units, rev, orders) => ({ sku, units, rev, orders });

// ---------- cenários principais ----------

withDb('importação completa: totais do período e pedidos únicos pelo identificador do pedido', async (db) => {
  const id = await stage(db, { file: 'Order.all.20261001_20261003.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 3, 30, ['o1', 'o2']), day('BBB', 1, 20, ['o1'])],
    '2026-10-02': [day('AAA', 1, 10, ['o3'])],
    '2026-10-03': [day('BBB', 2, 40, ['o4'])]
  } });
  const r = await commit(db, id);
  assert.equal(r.status, 'COMMITTED');
  const s = await summary(db, S, '2026-10');
  assert.equal(s.net_orders, 4, 'o1, o2, o3, o4');
  assert.equal(s.units, 7);
  assert.equal(s.rev, 100);
  assert.equal(s.period_key, '2026-10 (01-03)');
  assert.equal(s.pe, '2026-10-03');
  assert.deepEqual(r.coverage, { start: '2026-10-01', end: '2026-10-03', final_through: '2026-10-03' });
});

withDb('pedido com 2 SKUs conta 1 pedido; a soma de pedidos por SKU nunca vira pedidos únicos', async (db) => {
  const id = await stage(db, { file: 'Order.all.a.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1']), day('BBB', 1, 20, ['o1'])],
    '2026-10-02': [day('AAA', 1, 10, ['o2']), day('BBB', 1, 20, ['o2'])]
  } });
  await commit(db, id);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.net_orders, 2);
  const owi = (await rowsOf(db, S, '2026-10')).reduce((a, r) => a + r.owi, 0);
  assert.equal(owi, 4, 'orders_with_item soma por SKU = 4, e isso NÃO é o número de pedidos');
  assert.equal(s.units, 4);
});

withDb('importação incremental preserva os dias anteriores do mês e soma os novos', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 2, 20, ['o1'])], '2026-10-02': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-11'), days: {
    '2026-10-03': [day('AAA', 3, 30, ['o3', 'o4'])], '2026-10-04': [day('BBB', 1, 20, ['o5'])] } });
  const r = await commit(db, b);
  assert.deepEqual(r.rebuilt_months, ['2026-10']);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 7); assert.equal(s.rev, 80); assert.equal(s.net_orders, 5);
  assert.equal(s.pe, '2026-10-04');
  const rows = await rowsOf(db, S, '2026-10');
  assert.deepEqual(rows.map((x) => [x.sku, x.units]), [['AAA', 6], ['BBB', 1]]);
  // dados diários do arquivo A continuam inteiros (nada foi apagado)
  assert.equal((await db.one(`select count(*)::int n from commerce_shopee_sales_sku_daily_v1 where batch_id = $1`, [a])).n, 2);
});

withDb('arquivos sobrepostos: o mais novo substitui só os dias em comum, sem duplicar, pedido repetido conta 1', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-02': [day('AAA', 1, 10, ['o2'])], '2026-10-03': [day('AAA', 1, 10, ['o3'])] } });
  await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-12'), days: {
    '2026-10-03': [day('AAA', 2, 20, ['o3', 'o3b'])], '2026-10-04': [day('AAA', 1, 10, ['o4'])] } });
  await commit(db, b);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 5, 'dia 1:1 + dia 2:1 + dia 3 (novo): 2 + dia 4: 1');
  assert.equal(s.net_orders, 5, 'o1,o2,o3,o3b,o4 — o3 aparece nos dois arquivos mas conta uma vez');
  const sup = await db.one(`select count(*)::int n from commerce_shopee_sku_daily_superseded_v1`);
  assert.equal(sup.n, 1, 'só o dia 3 do arquivo antigo foi substituído e ficou guardado');
});

withDb('importação repetida: o mesmo arquivo de novo não muda nenhum total', async (db) => {
  const mk = () => ({ file: 'a.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 2, 20, ['o1'])], '2026-10-02': [day('BBB', 1, 20, ['o2'])] } });
  const a = await stage(db, mk());
  await commit(db, a);
  const before = await summary(db, S, '2026-10');
  const rowsBefore = await rowsOf(db, S, '2026-10');
  const b = await stage(db, mk());
  await commit(db, b);
  assert.deepEqual(await summary(db, S, '2026-10'), before);
  assert.deepEqual(await rowsOf(db, S, '2026-10'), rowsBefore);
  // commit do mesmo lote já confirmado devolve o resultado anterior e não cria snapshot novo
  const n1 = (await db.one('select count(*)::int n from commerce_sales_snapshots')).n;
  const again = await commit(db, b);
  assert.equal(again.already_committed, true);
  assert.equal((await db.one('select count(*)::int n from commerce_sales_snapshots')).n, n1);
});

withDb('arquivo em partes: espera as partes, une as duas e pedido que aparece nas duas partes conta 1', async (db) => {
  const p1 = await stage(db, { file: 'Order.all.2026_part_1_of_2.xlsx', created: T('2026-10-10'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-02': [day('AAA', 1, 10, ['oX'])] } });
  const w = await commit(db, p1);
  assert.equal(w.status, 'WAITING_PARTS');
  assert.deepEqual([w.parts_received, w.parts_expected, w.missing_parts], [1, 2, [2]], 'mesmo formato da v1: a tela mostra as partes que faltam');
  assert.equal((await db.one('select count(*)::int n from commerce_sales_snapshots')).n, 0);
  const p2 = await stage(db, { file: 'Order.all.2026_part_2_of_2.xlsx', created: T('2026-10-10'), days: {
    '2026-10-02': [day('BBB', 2, 40, ['oX', 'o2'])], '2026-10-03': [day('BBB', 1, 20, ['o3'])] } });
  const r = await commit(db, p2);
  assert.equal(r.status, 'COMMITTED'); assert.equal(r.merged_parts, 2);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 5);
  assert.equal(s.net_orders, 4, 'o1, oX (nas duas partes), o2, o3');
  const snaps = await db.q(`select distinct snapshot_id from commerce_sales_import_batches where status = 'COMMITTED'`);
  assert.equal(snaps.length, 1, 'as duas partes ficam no mesmo snapshot');
});

withDb('arquivo que atravessa dois meses reconstrói os dois e preserva os dias anteriores de outubro', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-25'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-29': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-11-05'), days: {
    '2026-10-30': [day('AAA', 1, 10, ['o3'])], '2026-10-31': [day('AAA', 1, 10, ['o4'])], '2026-11-01': [day('AAA', 2, 20, ['o5'])] } });
  const r = await commit(db, b);
  assert.deepEqual(r.rebuilt_months, ['2026-10', '2026-11']);
  const oct = await summary(db, S, '2026-10');
  assert.equal(oct.units, 4); assert.equal(oct.net_orders, 4); assert.equal(oct.period_key, '2026-10');
  const nov = await summary(db, S, '2026-11');
  assert.equal(nov.units, 2); assert.equal(nov.net_orders, 1);
});

withDb('preenchimento retroativo: dias antigos entram depois sem apagar os dias mais novos', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-11-20'), days: {
    '2026-11-10': [day('AAA', 1, 10, ['o1'])], '2026-11-12': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-11-21'), days: {
    '2026-11-01': [day('AAA', 1, 10, ['o3'])], '2026-11-09': [day('AAA', 1, 10, ['o4'])] } });
  await commit(db, b);
  const s = await summary(db, S, '2026-11');
  assert.equal(s.units, 4); assert.equal(s.net_orders, 4);
  assert.equal(s.pe, '2026-11-12');
});

withDb('dia parcial (arquivo gerado no próprio dia) não substitui dia completo', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: {
    '2026-10-04': [day('AAA', 5, 50, ['a1', 'a2', 'a3', 'a4', 'a5'])], '2026-10-05': [day('AAA', 6, 60, ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'])] } });
  await commit(db, a);
  // arquivo gerado em 05/10 ao meio-dia: o dia 5 está incompleto nele
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-05'), days: {
    '2026-10-04': [day('AAA', 5, 50, ['a1', 'a2', 'a3', 'a4', 'a5'])], '2026-10-05': [day('AAA', 1, 10, ['b1'])] } });
  const r = await commit(db, b);
  // o arquivo b (gerado em 05/10) é mais antigo que o a (gerado em 20/10): o dia 4 dele é STALE_FILE e o dia 5 é parcial
  assert.deepEqual(r.kept_days, [{ date: '2026-10-04', reason: 'STALE_FILE' }, { date: '2026-10-05', reason: 'PARTIAL_DAY' }]);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 11, 'dia 4 (5) + dia 5 do arquivo completo (6)');
  assert.equal(s.net_orders, 11);
  // e o dado diário do dia parcial NÃO ficou no lote novo
  assert.equal((await db.one(`select count(*)::int n from commerce_shopee_sales_sku_daily_v1 where batch_id = $1 and sale_date = '2026-10-05'`, [b])).n, 0);
});

withDb('arquivo gerado depois do último dia é completo e pode substituir', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-05'), days: { '2026-10-05': [day('AAA', 1, 10, ['b1'])] } });
  await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: '2026-10-06T03:00:00-03:00', days: { '2026-10-05': [day('AAA', 4, 40, ['b1', 'b2', 'b3', 'b4'])] } });
  const r = await commit(db, b);
  assert.deepEqual(r.kept_days, []);
  assert.equal((await summary(db, S, '2026-10')).units, 4);
});

withDb('dia intermediário sem registro NÃO vira "sem vendas": fica como "sem registro" e sem cobertura gravada', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-02': [day('AAA', 1, 10, ['o2'])], '2026-10-05': [day('AAA', 1, 10, ['o3'])] } });
  const r = await commit(db, a);
  assert.deepEqual(r.days_without_records, ['2026-10-03', '2026-10-04'], 'lacuna informada, sem afirmar que não houve venda');
  assert.equal(r.days_without_sales, undefined, 'a chave antiga que afirmava "sem vendas" não existe mais');
  const cov = await db.q(`select sale_date::text d from commerce_sales_day_coverage_v2 where batch_id = $1 order by 1`, [a]);
  assert.deepEqual(cov.map((c) => c.d), ['2026-10-01', '2026-10-02', '2026-10-05'], 'só dias com registro têm cobertura');
  const [wins] = await db.q(`select count(*)::int n from commerce_sales_day_winners_v2('SHOPEE','2026-10-01','2026-10-31')`);
  assert.equal(wins.n, 3);
});

withDb('arquivo filtrado/incompleto (omite dias) não apaga os dias que já estavam importados', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-02': [day('AAA', 2, 20, ['o2', 'o2b'])], '2026-10-03': [day('AAA', 3, 30, ['o3', 'o3b', 'o3c'])],
    '2026-10-04': [day('AAA', 4, 40, ['o4', 'o4b', 'o4c', 'o4d'])] } });
  await commit(db, a);
  // arquivo filtrado: cobre 01 a 04, mas só traz os dias 01 e 04 (02 e 03 foram filtrados fora do relatório)
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-21'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-04': [day('AAA', 4, 40, ['o4', 'o4b', 'o4c', 'o4d'])] } });
  const r = await commit(db, b);
  assert.deepEqual(r.days_without_records, ['2026-10-02', '2026-10-03']);
  assert.deepEqual(r.kept_days, []);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 10, 'dias 02 e 03 continuam como estavam');
  assert.equal(s.net_orders, 10);
});

withDb('arquivo que não traz um dia já importado mantém esse dia (não é "zero venda")', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 3, 30, ['o1', 'o2', 'o3'])] } });
  await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-21'), days: {
    '2026-09-30': [day('AAA', 1, 10, ['p1'])], '2026-10-02': [day('AAA', 1, 10, ['o4'])] } });
  const r = await commit(db, b);
  assert.deepEqual(r.kept_days, []);
  assert.deepEqual(r.days_without_records, ['2026-10-01']);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 4, 'dia 1 (3, do arquivo A) + dia 2 (1)');
  assert.equal((await summary(db, S, '2026-09')).units, 1);
});

withDb('dia que o primeiro arquivo não trouxe é preenchido quando um arquivo novo traz vendas nesse dia', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('AAA', 1, 10, ['o1'])], '2026-10-03': [day('AAA', 1, 10, ['o3'])] } });
  await commit(db, a);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-10-21'), days: { '2026-10-02': [day('AAA', 2, 20, ['o2', 'o2b'])] } });
  await commit(db, b);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 4); assert.equal(s.net_orders, 4);
});

// ---------- falhas: nada pela metade ----------

async function assertAtomicFailure(db, id, code) {
  const before = await fingerprint(db);
  const e = await commitError(db, id);
  assert.ok(e, 'devia falhar');
  assert.match(e.message, new RegExp(code));
  assert.deepEqual(await fingerprint(db), before, 'nenhuma alteração parcial pode ficar (inclui versão do cache)');
}

withDb('Order.toship não substitui vendas confirmadas e não altera nada', async (db) => {
  const a = await stage(db, { file: 'Order.all.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 9, 90, ['o1'])] } });
  await commit(db, a);
  const t = await stage(db, { file: 'Order.toship.20261021.xlsx', created: T('2026-10-21'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  await assertAtomicFailure(db, t, 'sales_import_toship_blocked');
  assert.equal((await summary(db, S, '2026-10')).units, 9);
});

withDb('lote sem identificadores de pedido, em formato mensal ou inconsistente é recusado sem alterar nada', async (db) => {
  const ok = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, ok);
  const noOrders = await stage(db, { file: 'b.xlsx', created: T('2026-10-21'), days: { '2026-10-02': [day('AAA', 1, 10, ['o2'])] } });
  await db.q('delete from commerce_sales_import_stage_orders_v2 where batch_id = $1', [noOrders]);
  await assertAtomicFailure(db, noOrders, 'sales_import_orders_required');
  const monthly = await stage(db, { file: 'c.xlsx', created: T('2026-10-21'), days: { '2026-10-03': [day('AAA', 1, 10, ['o3'])] } });
  await db.q(`update commerce_sales_import_stage_rows set period_start = '2026-10-01' where batch_id = $1`, [monthly]);
  await assertAtomicFailure(db, monthly, 'sales_import_day_level_required');
  const mismatch = await stage(db, { file: 'd.xlsx', created: T('2026-10-21'), days: { '2026-10-04': [day('AAA', 1, 10, ['o4'])] } });
  await db.q(`update commerce_sales_import_stage_orders_v2 set sale_date = '2026-10-09' where batch_id = $1`, [mismatch]);
  await assertAtomicFailure(db, mismatch, 'sales_import_orders_mismatch');
  const daily = await stage(db, { file: 'e.xlsx', created: T('2026-10-21'), days: { '2026-10-05': [day('AAA', 2, 20, ['o5', 'o6'])] } });
  await db.q(`update commerce_shopee_sales_sku_daily_v1 set units = 99 where batch_id = $1`, [daily]);
  await assertAtomicFailure(db, daily, 'sales_import_daily_mismatch');
});

withDb('falha no meio da montagem (pedidos não calculáveis) desfaz tudo, inclusive o que já tinha sido apagado/gravado', async (db) => {
  // mês legado de 20 dias (sem identificadores de pedido). Um arquivo novo cobre só o meio dele.
  const days = {};
  for (let d = 1; d <= 20; d++) days[`2026-10-${String(d).padStart(2, '0')}`] = [day('AAA', 1, 10, [`l${d}`])];
  await seedLegacyShopee(db, { month: '2026-10', through: '2026-10-20', days, blockOrders: 20, committedAt: T('2026-10-21') });
  const n = await stage(db, { file: 'n.xlsx', created: T('2026-10-25'), days: {
    '2026-10-10': [day('AAA', 2, 20, ['n1', 'n2'])], '2026-10-11': [day('AAA', 1, 10, ['n3'])] } });
  // os dias 10 e 11 substituem dias do mês legado -> o commit mexe nos dados diários antes de falhar mais adiante
  const before = await fingerprint(db);
  const e = await commitError(db, n);
  assert.ok(e); assert.match(e.message, /sales_import_orders_unresolved/);
  assert.deepEqual(await fingerprint(db), before);
  assert.equal((await db.one('select status from commerce_sales_import_batches where id = $1', [n])).status, 'STAGED');
});

withDb('mês salvo que os dados diários não reproduzem não é reconstruído (não perde vendas)', async (db) => {
  // resumo de outubro com 100 unidades, sem nenhum dado diário por trás
  await seedLegacyShopee(db, { month: '2026-10', through: '2026-10-10', days: {}, blockOrders: 50, committedAt: T('2026-10-11') });
  await db.q(`update commerce_sales_summary_rows set units = 100`);
  await db.q(`insert into commerce_sales_rows(snapshot_id, source_row_number, platform_code, period_key, period_start, period_end, sku_primary, sku, sku_norm, units, product_revenue)
    select snapshot_id, 1, 'SHOPEE', period_key, period_start, period_end, 'ZZZ', 'ZZZ', 'ZZZ', 100, 1000 from commerce_sales_summary_rows`);
  const n = await stage(db, { file: 'n.xlsx', created: T('2026-10-20'), days: { '2026-10-15': [day('AAA', 1, 10, ['n1'])] } });
  await assertAtomicFailure(db, n, 'sales_import_month_not_rebuildable');
});

// ---------- mês legado ----------

withDb('mês legado de outubro (resumo errado) é corrigido pelo reexport completo e os pedidos ficam exatos', async (db) => {
  const days = {};
  for (let d = 1; d <= 10; d++) days[`2026-10-${String(d).padStart(2, '0')}`] = [day('AAA', 2, 20, [`l${d}`])];
  await seedLegacyShopee(db, { month: '2026-10', through: '2026-10-10', days, blockOrders: 10, committedAt: T('2026-10-11') });
  // reexport do mês inteiro (3 dias de novo + o resto): cobre todos os dias do legado
  const full = {};
  for (let d = 1; d <= 31; d++) full[`2026-10-${String(d).padStart(2, '0')}`] = [day('AAA', 1, 10, [`n${d}`, `m${d}`].slice(0, 1))];
  const n = await stage(db, { file: 'Order.all.20261001_20261031.xlsx', created: T('2026-11-05'), days: full });
  const r = await commit(db, n);
  assert.equal(r.status, 'COMMITTED');
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 31); assert.equal(s.net_orders, 31); assert.equal(s.period_key, '2026-10');
});

withDb('mês legado de dias antigos mais arquivo novo de dias seguintes soma o bloco legado e os pedidos novos', async (db) => {
  const days = {};
  for (let d = 1; d <= 10; d++) days[`2026-10-${String(d).padStart(2, '0')}`] = [day('AAA', 1, 10, [`l${d}`])];
  await seedLegacyShopee(db, { month: '2026-10', through: '2026-10-10', days, blockOrders: 8, committedAt: T('2026-10-11') });
  const n = await stage(db, { file: 'n.xlsx', created: T('2026-10-20'), days: { '2026-10-11': [day('AAA', 1, 10, ['n1'])], '2026-10-12': [day('AAA', 1, 10, ['n2'])] } });
  await commit(db, n);
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 12); assert.equal(s.net_orders, 10, '8 pedidos do bloco legado + 2 novos');
});

withDb('mês legado em partes (mais de um arquivo no mesmo snapshot) não tem pedido exato: falha em vez de estimar', async (db) => {
  const days = {};
  for (let d = 1; d <= 6; d++) days[`2026-10-${String(d).padStart(2, '0')}`] = [day('AAA', 1, 10, [`l${d}`])];
  const { snapshot } = await seedLegacyShopee(db, { month: '2026-10', through: '2026-10-06', days, blockOrders: 6, committedAt: T('2026-10-07') });
  await db.q(`insert into commerce_sales_import_batches(platform_code, source_filename, status, snapshot_id, committed_at)
    values ('SHOPEE', 'Order.all.part_2_of_2.xlsx', 'COMMITTED', $1, now())`, [snapshot]);
  const n = await stage(db, { file: 'n.xlsx', created: T('2026-10-20'), days: { '2026-10-07': [day('AAA', 1, 10, ['n1'])] } });
  await assertAtomicFailure(db, n, 'sales_import_orders_unresolved');
});

// ---------- isolamento ----------

withDb('plataformas e meses não afetados ficam idênticos', async (db) => {
  const ml = await stage(db, { platform: 'ML_NOVO', file: 'ml.xlsx', created: T('2026-10-20'), days: {
    '2026-10-01': [day('MMM', 2, 40, ['m1', 'm2'])] } });
  await commit(db, ml);
  const sep = await stage(db, { file: 'sep.xlsx', created: T('2026-09-30'), days: { '2026-09-10': [day('AAA', 4, 40, ['s1', 's2', 's3', 's4'])] } });
  await commit(db, sep);
  const snapRows = async (platform, month) => db.q(`select period_key, sku_norm, units, orders_with_item, product_revenue::float8 rev
    from commerce_sales_rows r join commerce_sales_snapshots n on n.id = r.snapshot_id and n.is_current
    where platform_code = $1 and to_char(period_start,'YYYY-MM') = $2 order by 1,2`, [platform, month]);
  const snapSum = async (platform) => db.q(`select period_key, net_orders, units, product_revenue::float8 rev from commerce_sales_summary_rows s
    join commerce_sales_snapshots n on n.id = s.snapshot_id and n.is_current where platform_code = $1 order by 1`, [platform]);
  const mlBefore = [await snapRows('ML_NOVO', '2026-10'), await snapSum('ML_NOVO')];
  const sepBefore = await snapRows('SHOPEE', '2026-09');
  const oct = await stage(db, { file: 'oct.xlsx', created: T('2026-10-25'), days: { '2026-10-03': [day('AAA', 1, 10, ['o1'])] } });
  await commit(db, oct);
  assert.deepEqual([await snapRows('ML_NOVO', '2026-10'), await snapSum('ML_NOVO')], mlBefore);
  assert.deepEqual(await snapRows('SHOPEE', '2026-09'), sepBefore);
  assert.equal((await db.q(`select 1 from commerce_sales_summary_rows s join commerce_sales_snapshots n on n.id = s.snapshot_id and n.is_current
    where platform_code = 'SHOPEE' and period_key = '2026-09 (01-10)'`)).length, 1, 'setembro continua com o resumo e o rótulo que já tinha');
});

withDb('Mercado Livre: dias de arquivos diferentes se somam e pedidos vêm dos identificadores', async (db) => {
  const a = await stage(db, { platform: 'ML_ANTIGO', file: 'a.xlsx', created: T('2026-11-10'), days: {
    '2026-11-01': [day('MMM', 1, 10, ['m1']), day('NNN', 1, 15, ['m1'])], '2026-11-02': [day('MMM', 1, 10, ['m2'])] } });
  await commit(db, a);
  const b = await stage(db, { platform: 'ML_ANTIGO', file: 'b.xlsx', created: T('2026-11-12'), days: { '2026-11-03': [day('MMM', 2, 20, ['m3', 'm4'])] } });
  await commit(db, b);
  const s = await summary(db, 'ML_ANTIGO', '2026-11');
  assert.equal(s.units, 5); assert.equal(s.net_orders, 4); assert.equal(s.rev, 55);
});

// ---------- concorrência ----------

withDb('commits simultâneos são serializados pela trava global: o segundo espera e parte do resultado do primeiro', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  const b = await stage(db, { platform: 'ML_NOVO', file: 'b.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('MMM', 1, 10, ['m1'])] } });
  const c1 = await db.client(); const c2 = await db.client(); const spy = await db.client();
  await c1.query('begin');
  await c1.query('select public.commerce_commit_sales_import_v2($1)', [a]);
  let c2done = false;
  const second = c2.query('select public.commerce_commit_sales_import_v2($1) r', [b]).then((r) => { c2done = true; return r; });
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(c2done, false, 'o segundo commit tem que estar esperando');
  const waiting = await spy.query(`select count(*)::int n from pg_locks where locktype = 'advisory' and not granted`);
  assert.equal(waiting.rows[0].n, 1, 'há exatamente uma espera pela trava global');
  await c1.query('commit');
  const r2 = (await second).rows[0].r;
  assert.equal(r2.status, 'COMMITTED');
  assert.equal((await db.one('select count(*)::int n from commerce_sales_snapshots')).n, 2);
  assert.equal((await db.one('select count(*)::int n from commerce_sales_snapshots where is_current')).n, 1);
  // sem "atualização perdida": o snapshot final tem as duas plataformas
  const plats = await db.q(`select distinct platform_code from commerce_sales_summary_rows s join commerce_sales_snapshots n on n.id = s.snapshot_id and n.is_current order by 1`);
  assert.deepEqual(plats.map((p) => p.platform_code), ['ML_NOVO', 'SHOPEE']);
});

withDb('muitos commits ao mesmo tempo: nenhum se perde, um único snapshot atual', async (db) => {
  const ids = [];
  for (let d = 1; d <= 6; d++) ids.push(await stage(db, { file: `f${d}.xlsx`, created: T('2026-10-20'),
    days: { [`2026-10-0${d}`]: [day('AAA', 1, 10, [`o${d}`])] } }));
  const clients = [];
  for (let i = 0; i < ids.length; i++) clients.push(await db.client());
  const out = await Promise.all(ids.map((id, i) => clients[i].query('select public.commerce_commit_sales_import_v2($1) r', [id])));
  assert.ok(out.every((o) => o.rows[0].r.status === 'COMMITTED'));
  const s = await summary(db, S, '2026-10');
  assert.equal(s.units, 6); assert.equal(s.net_orders, 6); assert.equal(s.pe, '2026-10-06');
  assert.equal((await db.one('select count(*)::int n from commerce_sales_snapshots where is_current')).n, 1);
});

withDb('a trava global é de transação: solta ao confirmar e ao falhar', async (db) => {
  const a = await stage(db, { file: 'Order.toship.x.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  const c = await db.client();
  await c.query('begin');
  await c.query('savepoint s');
  await assert.rejects(c.query('select public.commerce_commit_sales_import_v2($1)', [a]), /toship/);
  await c.query('rollback');
  const locks = await db.one(`select count(*)::int n from pg_locks where locktype = 'advisory'`);
  assert.equal(locks.n, 0);
});

// ---------- cache ----------

withDb('a versão de dados do cache só muda depois de um commit bem-sucedido', async (db) => {
  const v0 = (await db.one('select public.commerce_data_version_v1() v')).v;
  const bad = await stage(db, { file: 'Order.toship.a.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  assert.ok(await commitError(db, bad));
  assert.equal((await db.one('select public.commerce_data_version_v1() v')).v, v0, 'falha não invalida o cache');
  const p1 = await stage(db, { file: 'x_part_1_of_2.xlsx', created: T('2026-10-20'), days: { '2026-10-01': [day('AAA', 1, 10, ['o1'])] } });
  assert.equal((await commit(db, p1)).status, 'WAITING_PARTS');
  assert.equal((await db.one('select public.commerce_data_version_v1() v')).v, v0, 'esperar partes não invalida o cache');
  const ok = await stage(db, { file: 'ok.xlsx', created: T('2026-10-20'), days: { '2026-10-02': [day('AAA', 1, 10, ['o2'])] } });
  await commit(db, ok);
  assert.notEqual((await db.one('select public.commerce_data_version_v1() v')).v, v0, 'commit invalida o cache');
});

// ---------- permissões ----------

withDb('somente service_role executa as funções e lê as tabelas novas', async (db) => {
  const fns = ['commerce_commit_sales_import_v2(bigint)', 'commerce_append_sales_import_orders_v2(bigint,jsonb)',
    'commerce_activate_shopee_finance_v2(bigint)', 'commerce_sales_day_winners_v2(text,date,date)',
    'commerce_sales_day_rows_v2(text,date,date)', 'commerce_sales_month_orders_v2(text,date)'];
  for (const f of fns) {
    for (const role of ['anon', 'authenticated', 'public']) {
      const p = (await db.one(`select has_function_privilege($1, 'public.${f}', 'execute') ok`, [role === 'public' ? 'postgres' : role])).ok;
      if (role !== 'public') assert.equal(p, false, `${role} não pode executar ${f}`);
    }
    assert.equal((await db.one(`select has_function_privilege('service_role', 'public.${f}', 'execute') ok`)).ok, true, `service_role executa ${f}`);
    assert.equal((await db.one(`select count(*)::int n from information_schema.routine_privileges where specific_schema = 'public'
      and routine_name = $1 and grantee = 'PUBLIC'`, [f.split('(')[0]])).n, 0, `PUBLIC sem acesso a ${f}`);
  }
  for (const t of ['commerce_sales_import_stage_orders_v2', 'commerce_sales_day_coverage_v2']) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.one(`select has_table_privilege($1, 'public.${t}', 'select') ok`, [role])).ok, false, `${role} não lê ${t}`);
    }
    assert.equal((await db.one(`select has_table_privilege('service_role', 'public.${t}', 'select') ok`)).ok, true);
    assert.equal((await db.one(`select relrowsecurity ok from pg_class where relname = $1`, [t])).ok, true, `RLS ligada em ${t}`);
  }
});

// ---------- envio de pedidos ----------

withDb('commerce_append_sales_import_orders_v2 valida o formato e só aceita lote aberto', async (db) => {
  const b = (await db.one(`insert into commerce_sales_import_batches(platform_code, source_filename, status) values ('SHOPEE','a.xlsx','STAGED') returning id`)).id;
  const ok = await db.one(`select public.commerce_append_sales_import_orders_v2($1, $2::jsonb) n`, [b, JSON.stringify([
    { d: '2026-10-01', k: orderKey(S, 'o1') }, { d: '2026-10-01', k: orderKey(S, 'o1') }, { d: '2026-10-02', k: orderKey(S, 'o2') }])]);
  assert.equal(ok.n, 2, 'duplicado no mesmo dia entra uma vez');
  await assert.rejects(db.q(`select public.commerce_append_sales_import_orders_v2($1, '[{"d":"2026-10-01","k":"123456"}]'::jsonb)`, [b]), /sales_import_orders_invalid/);
  await assert.rejects(db.q(`select public.commerce_append_sales_import_orders_v2($1, '[]'::jsonb)`, [b]), /sales_import_orders_array_required/);
  await db.q(`update commerce_sales_import_batches set status = 'COMMITTED' where id = $1`, [b]);
  await assert.rejects(db.q(`select public.commerce_append_sales_import_orders_v2($1, $2::jsonb)`, [b, JSON.stringify([{ d: '2026-10-03', k: orderKey(S, 'o3') }])]), /sales_import_batch_closed/);
});

// ---------- financeiro Shopee ----------

const fin = (month, ordersN, units, rev, singleOrders = ordersN) => ({ month, orders: ordersN, units, rev, fee: 1, feeOrders: ordersN, singleSku: singleOrders });

withDb('financeiro: mês inteiro do arquivo é publicado; mês misturado com outro arquivo não publica o mensal mas grava o diário', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-11-10'), days: {
    '2026-11-01': [day('AAA', 1, 10, ['o1'])], '2026-11-02': [day('AAA', 1, 10, ['o2'])] },
    finance: { days: [{ date: '2026-11-01', sku: 'AAA', orders: 1, units: 1, rev: 10, fee: 1 }, { date: '2026-11-02', sku: 'AAA', orders: 1, units: 1, rev: 10, fee: 1 }],
      months: [fin('2026-11-01', 2, 2, 20)] } });
  await commit(db, a);
  const r1 = await db.one('select public.commerce_activate_shopee_finance_v2($1) r', [a]);
  assert.deepEqual(r1.r.finance_months_published, ['2026-11-01']);
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_finance_month_v1')).n, 1);
  const b = await stage(db, { file: 'b.xlsx', created: T('2026-11-12'), days: { '2026-11-03': [day('AAA', 1, 10, ['o3'])] },
    finance: { days: [{ date: '2026-11-03', sku: 'AAA', orders: 1, units: 1, rev: 10, fee: 1 }], months: [fin('2026-11-01', 1, 1, 10)] } });
  await commit(db, b);
  const r2 = await db.one('select public.commerce_activate_shopee_finance_v2($1) r', [b]);
  assert.deepEqual(r2.r.finance_months_published, []);
  assert.deepEqual(r2.r.finance_months_mixed_not_published, ['2026-11-01']);
  assert.equal((await db.one('select count(*)::int n from commerce_shopee_finance_daily_v1')).n, 3, 'diário: dias 1, 2 e 3');
  const monthRow = await db.one('select source_snapshot_id, units from commerce_shopee_finance_month_v1');
  assert.equal(monthRow.units, 2, 'mensal antigo não é sobrescrito por um total parcial');
});

withDb('financeiro: total do arquivo diferente das vendas do arquivo derruba a ativação', async (db) => {
  const a = await stage(db, { file: 'a.xlsx', created: T('2026-11-10'), days: { '2026-11-01': [day('AAA', 1, 10, ['o1'])] },
    finance: { days: [{ date: '2026-11-01', sku: 'AAA', orders: 1, units: 1, rev: 10, fee: 1 }], months: [fin('2026-11-01', 1, 5, 10)] } });
  await commit(db, a);
  await assert.rejects(db.q('select public.commerce_activate_shopee_finance_v2($1)', [a]), /Totais financeiros diferentes/);
});

// ---------- ponta a ponta: planilha fictícia -> leitor real -> banco ----------
import { makeXlsx } from '../helpers/make-xlsx.js';
import { readCommerceSalesXlsx } from '../../src/ga/commerce-sales-import-reader.js';
import { hashOrderRefs } from '../../src/ga/commerce-order-keys.js'; // o MESMO módulo que a rota do servidor usa

async function stageParsed(db, parsed, file, created) {
  const b = await db.one(`insert into commerce_sales_import_batches(platform_code, source_filename, status, created_at) values ($1,$2,'STAGED',$3) returning id`,
    [parsed.platform_code, file, created]);
  for (const r of parsed.rows) {
    await db.q(`insert into commerce_sales_import_stage_rows(batch_id, source_row_number, period_key, period_start, period_end, sku_primary, sku, sku_norm, product_name, variation, units, orders_with_item, product_revenue)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [b.id, r.source_row_number, r.period_key, r.period_start, r.period_end, r.sku_primary, r.sku, r.sku_norm, r.product_name, r.variation, r.units, r.orders_with_item, r.product_revenue]);
  }
  for (const r of parsed.summaries) {
    await db.q(`insert into commerce_sales_import_stage_summary(batch_id, period_key, period_start, period_end, net_orders, units, product_revenue, listings_with_sales, skus_with_sales)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [b.id, r.period_key, r.period_start, r.period_end, r.net_orders, r.units, r.product_revenue, r.listings_with_sales, r.skus_with_sales]);
  }
  for (const r of parsed.sku_daily_rows || []) {
    await db.q(`insert into commerce_shopee_sales_sku_daily_v1(batch_id, sale_date, sku_norm, units, orders_with_item, product_revenue) values ($1,$2,$3,$4,$5,$6)`,
      [b.id, r.sale_date, r.sku_norm, r.units, r.orders_with_item, r.product_revenue]);
  }
  for (const r of parsed.listing_rows || []) {
    await db.q(`insert into commerce_sales_listing_daily_v1(batch_id, sale_date, external_listing_id, sku_norm, units, orders_with_item, product_revenue) values ($1,$2,$3,$4,$5,$6,$7)`,
      [b.id, r.sale_date, r.external_listing_id, r.sku_norm, r.units, r.orders_with_item, r.product_revenue]);
  }
  const keys = hashOrderRefs('segredo-de-teste-'.repeat(3), parsed.platform_code, parsed.order_refs); // o que o Worker faria
  await db.q('select public.commerce_append_sales_import_orders_v2($1, $2::jsonb)', [b.id, JSON.stringify(keys)]);
  await db.q('select public.commerce_set_sales_import_meta_v2($1, $2::timestamptz)', [b.id, created]); // data de geração do arquivo
  return b.id;
}

const SH_HEAD = ['ID do pedido', 'Status do pedido', 'Hora do pagamento do pedido', 'Data de criação do pedido', 'Número de referência SKU', 'SKU', 'Quantidade', 'Subtotal do produto'];
const shLine = (id, date, sku, qty, rev) => [id, 'Concluído', `${date} 10:00`, `${date} 09:00`, sku, sku, qty, rev];
const shFile = (rows, name) => new File([makeXlsx([SH_HEAD, ...rows])], name);

withDb('ponta a ponta Shopee: dois arquivos fictícios reais (dias seguidos) somam sem perder o primeiro', async (db) => {
  const p1 = await readCommerceSalesXlsx(shFile([shLine('9001', '2026-11-01', 'AAA', 2, '20,00'), shLine('9001', '2026-11-01', 'BBB', 1, '20,00'),
    shLine('9002', '2026-11-02', 'AAA', 1, '10,00')], 'Order.all.1.xlsx'), 'SHOPEE');
  const p2 = await readCommerceSalesXlsx(shFile([shLine('9003', '2026-11-03', 'AAA', 1, '10,00'), shLine('9004', '2026-11-04', 'BBB', 2, '40,00')], 'Order.all.2.xlsx'), 'SHOPEE');
  const a = await stageParsed(db, p1, 'Order.all.1.xlsx', T('2026-11-10'));
  assert.equal((await commit(db, a)).status, 'COMMITTED');
  const b = await stageParsed(db, p2, 'Order.all.2.xlsx', T('2026-11-11'));
  assert.equal((await commit(db, b)).status, 'COMMITTED');
  const s = await summary(db, S, '2026-11');
  assert.equal(s.units, 7); assert.equal(s.rev, 100); assert.equal(s.net_orders, 4); assert.equal(s.pe, '2026-11-04');
});

withDb('ponta a ponta Mercado Livre: planilha oficial fictícia passa pelo leitor e pelo commit', async (db) => {
  const head = ['N.º de venda', 'Data de venda', 'Depósito', 'Estado', 'Descrição do status', 'Pacote de diversos produtos', 'Pertence a um kit', 'Unidades',
    'Receita por produtos (BRL)', 'Receita por acréscimo no preço (pago pelo comprador)', 'Taxa de parcelamento equivalente ao acréscimo', 'Tarifa de venda e impostos (BRL)',
    'Receita por envio (BRL)', 'Tarifas de envio (BRL)', 'Custo de envio por troca de produto', 'Custo de envio com base nas medidas e peso declarados',
    'Custo por diferenças nas medidas e no peso do pacote', 'Descontos e bônus', 'Cancelamentos e reembolsos (BRL)', 'Total (BRL)', 'Mês de faturamento das suas tarifas',
    'Pedido de compra', 'Venda por publicidade', 'SKU', '# de anúncio', 'Loja oficial', 'Título do anúncio', 'Variação', 'Preço unitário de venda do anúncio (BRL)'];
  const ln = (id, day, sku, ad, qty, price) => { const c = Array.from({ length: 29 }, () => null); c[0] = id; c[1] = day; c[3] = 'Entregue'; c[7] = qty; c[8] = price * qty; c[23] = sku; c[24] = ad; c[26] = 'Item'; c[28] = price; return c; };
  const wb = [['Vendas BR'], [], [], [], [], ['Vendas'], head,
    ln('3001', '15 de outubro de 2026 17:40 hs.', 'MMM', 'MLB1', 1, 30), ln('3002', '15 de outubro de 2026 18:00 hs.', 'MMM', 'MLB1', 2, 30), ln('3003', '16 de outubro de 2026 09:00 hs.', 'NNN', 'MLB2', 1, 45)];
  const parsed = await readCommerceSalesXlsx(new File([makeXlsx(wb, 'Vendas BR')], 'vendas.xlsx'), 'ML_NOVO');
  const id = await stageParsed(db, parsed, 'vendas.xlsx', T('2026-10-20'));
  assert.equal((await commit(db, id)).status, 'COMMITTED');
  const s = await summary(db, 'ML_NOVO', '2026-10');
  assert.equal(s.units, 4); assert.equal(s.net_orders, 3); assert.equal(s.rev, 135);
});
