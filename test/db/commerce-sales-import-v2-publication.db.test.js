// GA-019 — revisão final antes da publicação: troca/perda/comprometimento do segredo HMAC, migração aplicada com o GA
// atual (v1) ainda em uso e plataforma do HMAC. Postgres 17 local descartável, dados fictícios. Rodar: npm run test:db
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startServer, stopServer, newDb, applyV2Migration, stageParsedWithSecret, stageV1Monthly, commit, commitError, summary, fingerprint } from './harness.mjs';
import { makeXlsx } from '../helpers/make-xlsx.js';
import { readCommerceSalesXlsx } from '../../src/ga/commerce-sales-import-reader.js';

before(async () => { await startServer(); });
after(async () => { await stopServer(); });

const T = (d) => `${d}T12:00:00-03:00`;
const S = 'SHOPEE';
const SECRET_A = 'segredo-A-de-teste-'.repeat(3);
const SECRET_B = 'segredo-B-de-teste-'.repeat(3);
const withDb = (name, fn, opts) => test(name, async () => {
  const db = await newDb(opts);
  try { await fn(db); } finally { await db.close(); }
});

const HEAD = ['ID do pedido', 'Status do pedido', 'Hora do pagamento do pedido', 'Data de criação do pedido', 'Número de referência SKU', 'SKU', 'Quantidade', 'Subtotal do produto'];
const line = (id, date, sku, qty, rev) => [id, 'Concluído', `${date} 10:00`, `${date} 09:00`, sku, sku, qty, rev];
// Importa um arquivo fictício REAL (leitor do navegador + HMAC do Worker com o segredo dado).
async function importFile(db, secret, name, created, lines) {
  const parsed = await readCommerceSalesXlsx(new File([makeXlsx([HEAD, ...lines])], name), S);
  return stageParsedWithSecret(db, parsed, name, created, secret);
}
// SQL do procedimento de publicação (docs/cerebro/ga-019-publicacao.md): o que está no documento é o que é testado aqui.
const RUNBOOK = fs.readFileSync(new URL('../../docs/cerebro/ga-019-publicacao.md', import.meta.url), 'utf8');
const FENCE = '`'.repeat(3);
const docSql = (name) => {
  const start = RUNBOOK.indexOf(`<!-- sql:${name} -->`);
  assert.ok(start >= 0, `bloco sql:${name} existe no runbook`);
  const open = RUNBOOK.indexOf(`${FENCE}sql\n`, start);
  const close = RUNBOOK.indexOf(FENCE, open + 6);
  assert.ok(open > start && RUNBOOK.slice(start, open).trim().split('\n').length === 1, `bloco sql:${name} vem logo depois do marcador`);
  return RUNBOOK.slice(open + 7, close);
};
const keysOf = (db) => db.q('select batch_id, sale_date::text d, order_key k from commerce_sales_import_stage_orders_v2 order by 1,2,3');

// ---------- 2. troca do segredo: histórico e reimportações ----------

withDb('trocar o segredo: meses já confirmados não mudam, dias novos entram e reimportar um dia não conta o pedido duas vezes', async (db) => {
  const a = await importFile(db, SECRET_A, 'Order.all.1.xlsx', T('2026-10-05'),
    [line('A1', '2026-10-01', 'AAA', 1, '10,00'), line('A2', '2026-10-01', 'AAA', 1, '10,00'), line('A3', '2026-10-02', 'AAA', 1, '10,00')]);
  assert.equal((await commit(db, a)).status, 'COMMITTED');
  assert.equal((await summary(db, S, '2026-10')).net_orders, 3);
  const keysBefore = await keysOf(db);

  // --- o segredo é trocado aqui ---
  const b = await importFile(db, SECRET_B, 'Order.all.2.xlsx', T('2026-10-06'),
    [line('A4', '2026-10-03', 'AAA', 1, '10,00'), line('A5', '2026-10-04', 'AAA', 1, '10,00')]);
  assert.equal((await commit(db, b)).status, 'COMMITTED');
  assert.equal((await summary(db, S, '2026-10')).net_orders, 5, 'histórico (chaves do segredo antigo) + dias novos (segredo novo) = pedidos exatos');
  assert.deepEqual((await keysOf(db)).filter((r) => r.batch_id === keysBefore[0].batch_id), keysBefore, 'as chaves antigas não são recalculadas nem apagadas');

  // reimportar os MESMOS dias 1 e 2 com o segredo novo: o lote novo substitui o dia inteiro (chaves antigas deixam de contar)
  const c = await importFile(db, SECRET_B, 'Order.all.3.xlsx', T('2026-10-07'),
    [line('A1', '2026-10-01', 'AAA', 1, '10,00'), line('A2', '2026-10-01', 'AAA', 1, '10,00'), line('A3', '2026-10-02', 'AAA', 1, '10,00')]);
  assert.equal((await commit(db, c)).status, 'COMMITTED');
  const s = await summary(db, S, '2026-10');
  assert.equal(s.net_orders, 5, 'nenhum pedido contado duas vezes depois de reimportar com outro segredo');
  assert.equal(s.units, 5);
});

withDb('LIMITE CONHECIDO: partes do MESMO arquivo enviadas antes e depois da troca contam o pedido que aparece nas duas partes em dobro', async (db) => {
  const mk = async (secret, part, created, lines) => importFile(db, secret, `Order.all.20261001_20261031_part_${part}_of_2.xlsx`, created, lines);
  // controle: mesmo segredo nas duas partes -> pedido X (com itens nas duas partes) conta 1 vez
  const c1 = await mk(SECRET_A, 1, T('2026-11-02'), [line('X', '2026-10-01', 'AAA', 1, '10,00')]);
  assert.equal((await commit(db, c1)).status, 'WAITING_PARTS');
  const c2 = await mk(SECRET_A, 2, T('2026-11-02'), [line('X', '2026-10-01', 'BBB', 1, '10,00'), line('Y', '2026-10-01', 'AAA', 1, '10,00')]);
  assert.equal((await commit(db, c2)).status, 'COMMITTED');
  assert.equal((await summary(db, S, '2026-10')).net_orders, 2, 'X e Y = 2 pedidos');

  const db2 = await newDb();
  try {
    const d1 = await importFile(db2, SECRET_A, 'Order.all.20261001_20261031_part_1_of_2.xlsx', T('2026-11-02'), [line('X', '2026-10-01', 'AAA', 1, '10,00')]);
    assert.equal((await commit(db2, d1)).status, 'WAITING_PARTS');
    // --- segredo trocado entre as partes ---
    const d2 = await importFile(db2, SECRET_B, 'Order.all.20261001_20261031_part_2_of_2.xlsx', T('2026-11-02'), [line('X', '2026-10-01', 'BBB', 1, '10,00'), line('Y', '2026-10-01', 'AAA', 1, '10,00')]);
    assert.equal((await commit(db2, d2)).status, 'COMMITTED');
    assert.equal((await summary(db2, S, '2026-10')).net_orders, 3, 'X contado duas vezes (chaves de segredos diferentes): por isso não girar o segredo com partes pendentes');
  } finally { await db2.close(); }
});

// ---------- 2. segredo comprometido: limpeza das chaves antigas ----------

const countOld = async (db) => Number((await db.one(docSql('superseded-count'))).chaves_antigas);

withDb('segredo comprometido: reexportar o mês com o segredo novo e só então apagar as chaves antigas não muda os números', async (db) => {
  const a = await importFile(db, SECRET_A, 'Order.all.1.xlsx', T('2026-10-05'),
    [line('A1', '2026-10-01', 'AAA', 1, '10,00'), line('A2', '2026-10-02', 'AAA', 1, '10,00')]);
  await commit(db, a);
  const b = await importFile(db, SECRET_A, 'Order.all.2.xlsx', T('2026-10-06'), [line('A3', '2026-10-03', 'AAA', 1, '10,00')]);
  await commit(db, b);
  assert.equal(await countOld(db), 0, 'antes de reimportar, todas as chaves ainda sustentam algum dia');

  // segredo trocado + mês inteiro reexportado
  const full = await importFile(db, SECRET_B, 'Order.all.mes.xlsx', T('2026-10-08'),
    [line('A1', '2026-10-01', 'AAA', 1, '10,00'), line('A2', '2026-10-02', 'AAA', 1, '10,00'), line('A3', '2026-10-03', 'AAA', 1, '10,00')]);
  assert.equal((await commit(db, full)).status, 'COMMITTED');
  const before = await summary(db, S, '2026-10');
  assert.equal(await countOld(db), 3, 'as 3 chaves do segredo antigo já não sustentam nenhum dia');
  await db.q(docSql('superseded-delete'));
  assert.equal(await countOld(db), 0);
  assert.ok((await keysOf(db)).every((r) => r.batch_id === full), 'sobraram só as chaves do lote novo');
  assert.deepEqual(await summary(db, S, '2026-10'), before, 'resumo igual depois da limpeza');
  assert.equal((await db.one('select count(*)::int n from commerce_sales_import_stage_orders_v2')).n, 3, 'ficam só as chaves do segredo novo');

  const next = await importFile(db, SECRET_B, 'Order.all.4.xlsx', T('2026-10-09'), [line('A9', '2026-10-04', 'AAA', 1, '10,00')]);
  assert.equal((await commit(db, next)).status, 'COMMITTED');
  assert.equal((await summary(db, S, '2026-10')).net_orders, 4, 'o mês continua exato depois da limpeza');
});

withDb('apagar por engano as chaves que AINDA sustentam dias: o próximo commit do mês recusa e nada muda (nunca subconta em silêncio)', async (db) => {
  const a = await importFile(db, SECRET_A, 'Order.all.1.xlsx', T('2026-10-05'),
    [line('A1', '2026-10-01', 'AAA', 1, '10,00'), line('A2', '2026-10-02', 'AAA', 1, '10,00')]);
  await commit(db, a);
  await db.q('delete from commerce_sales_import_stage_orders_v2');  // erro do operador: apagou tudo, inclusive o que sustenta o mês
  const next = await importFile(db, SECRET_B, 'Order.all.2.xlsx', T('2026-10-06'), [line('A3', '2026-10-03', 'AAA', 1, '10,00')]);
  const before = await fingerprint(db);
  const e = await commitError(db, next);
  assert.ok(e, 'devia recusar');
  assert.match(e.message, /sales_import_orders_unresolved/);
  assert.deepEqual(await fingerprint(db), before, 'nada ficou pela metade');
  assert.equal((await summary(db, S, '2026-10')).net_orders, 2, 'o resumo anterior segue intacto');
});

// ---------- 3. migração aplicada com o GA atual (v1) em produção ----------

const seedV1 = async (db) => {
  const m10 = await stageV1Monthly(db, { file: 'Order.all.out.xlsx', created: T('2026-11-01'), month: '2026-10', through: '2026-10-31',
    rows: [{ sku: 'AAA', units: 4, rev: 40, owi: 4 }, { sku: 'BBB', units: 2, rev: 30, owi: 2 }], netOrders: 5 });
  assert.equal((await db.one('select public.commerce_commit_sales_import_v1($1) r', [m10])).r.status, 'COMMITTED');
  const m11 = await stageV1Monthly(db, { file: 'Order.all.nov.xlsx', created: T('2026-11-05'), month: '2026-11', through: '2026-11-03',
    rows: [{ sku: 'AAA', units: 3, rev: 30, owi: 3 }], netOrders: 3 });
  assert.equal((await db.one('select public.commerce_commit_sales_import_v1($1) r', [m11])).r.status, 'COMMITTED');
};
const readState = async (db) => ({
  snapshot: Number((await db.one('select id from commerce_sales_snapshots where is_current')).id),
  oct: await summary(db, S, '2026-10'), nov: await summary(db, S, '2026-11'),
  view: await db.q('select * from commerce_current_sales_listing_daily_v1 order by 1,2,3,4'),
  version: (await db.one('select public.commerce_data_version_v1() v')).v
});

withDb('banco de produção de hoje + migração: nenhum dado nem leitura muda, e o GA atual (v1) continua importando', async (db) => {
  await seedV1(db);
  const before = await readState(db);
  await applyV2Migration(db);
  assert.deepEqual(await readState(db), before, 'resumos, view das telas e versão do cache idênticos depois de aplicar a migração');
  assert.equal((await db.one(`select count(*)::int n from pg_trigger where tgname like 'commerce_sales_delete_guard%'`)).n, 2);
  // o GA atual continua importando com a v1: substitui o mês, cria snapshot novo, nada é bloqueado
  const again = await stageV1Monthly(db, { file: 'Order.all.nov2.xlsx', created: T('2026-11-06'), month: '2026-11', through: '2026-11-05',
    rows: [{ sku: 'AAA', units: 5, rev: 50, owi: 5 }], netOrders: 5 });
  assert.equal((await db.one('select public.commerce_commit_sales_import_v1($1) r', [again])).r.status, 'COMMITTED');
  assert.equal((await summary(db, S, '2026-11')).units, 5);
  assert.equal((await summary(db, S, '2026-10')).units, 6, 'outubro intocado');
  // lote que o GA atual nunca confirmou continua podendo ser apagado (a trava só vale para o que a v2 processou)
  const open = await stageV1Monthly(db, { file: 'Order.all.aberto.xlsx', created: T('2026-11-07'), month: '2026-11', through: '2026-11-06', rows: [{ sku: 'ZZZ', units: 1, rev: 1 }], netOrders: 1 });
  await db.q('delete from commerce_sales_import_batches where id = $1', [open]);
  // e a migração é repetível sem efeito
  await applyV2Migration(db);
  assert.equal((await db.one(`select count(*)::int n from pg_trigger where tgname like 'commerce_sales_delete_guard%'`)).n, 2);
});

withDb('migração aplicada no meio de uma importação v1 em andamento: a importação termina normalmente e a migração entra logo depois', async (db) => {
  const m = await stageV1Monthly(db, { file: 'Order.all.out.xlsx', created: T('2026-11-01'), month: '2026-10', through: '2026-10-31',
    rows: [{ sku: 'AAA', units: 4, rev: 40, owi: 4 }], netOrders: 4 });
  const importer = await db.client();
  await importer.query('begin');
  const r = await importer.query('select public.commerce_commit_sales_import_v1($1) r', [m]);   // importação "no meio": transação aberta
  assert.equal(r.rows[0].r.status, 'COMMITTED');
  const migrator = await db.client();
  let done = false;
  const mig = applyV2MigrationOn(migrator).then(() => { done = true; });
  await new Promise((res) => setTimeout(res, 700));
  const waited = !done;
  await importer.query('commit');                                // a importação termina
  await mig;                                                     // e só então a migração conclui
  assert.equal((await summary(db, S, '2026-10')).units, 4, 'a importação em andamento foi salva');
  assert.equal((await db.one(`select count(*)::int n from pg_proc where proname = 'commerce_commit_sales_import_v2'`)).n, 1, 'migração concluída');
  assert.ok(waited, 'a migração espera a importação em andamento (não a derruba, não a corrompe)');
}, { beforeV2: true });
async function applyV2MigrationOn(client) {
  const { default: fs } = await import('node:fs');
  const { MIGRATION } = await import('./harness.mjs');
  await client.query(fs.readFileSync(MIGRATION, 'utf8'));
}

withDb('importação que segura a tabela por mais de 10 s: a migração desiste INTEIRA (lock_timeout), sem alterar nada, e pode ser repetida', async (db) => {
  const importer = await db.client();
  await importer.query('begin');
  await importer.query('lock table commerce_sales_import_batches in row exclusive mode');   // o que uma importação em andamento faz
  const migrator = await db.client();
  const t0 = Date.now();
  await assert.rejects(applyV2MigrationOn(migrator), /lock timeout|lock_not_available|canceling statement due to lock timeout/i);
  const waitedMs = Date.now() - t0;
  assert.ok(waitedMs >= 9000 && waitedMs < 15000, `esperou ~10 s (esperou ${waitedMs} ms)`);
  await importer.query('commit');
  assert.equal((await db.one(`select count(*)::int n from pg_proc where proname like 'commerce%\\_v2' and proname ~ 'sales_(import|day|month|commit|rollback|reconcile|daily|delete)'`)).n, 0, 'nada da v2 ficou');
  assert.equal((await db.one(`select count(*)::int n from pg_trigger where tgname like 'commerce_sales_delete_guard%'`)).n, 0);
  await applyV2MigrationOn(await db.client());                                               // repetir depois funciona
  assert.equal((await db.one(`select count(*)::int n from pg_proc where proname = 'commerce_commit_sales_import_v2'`)).n, 1);
}, { beforeV2: true });

// ---------- o SQL do runbook funciona de verdade ----------

withDb('runbook: pré-checagem, backup interno com conferência e linha de base rodam no banco de hoje e a cópia é fiel', async (db) => {
  await seedV1(db);
  const pre = await db.main.query(docSql('preflight'));
  assert.equal(pre[0].rows.length, 0, 'ninguém importando');
  assert.equal(pre[1].rows.length, 0, 'sem lotes abertos neste banco de teste');
  await db.main.query(docSql('backup'));
  const check = await db.q(docSql('backup-check'));
  assert.equal(check.length, 12);
  assert.ok(check.every((r) => r.igual === true), JSON.stringify(check));
  assert.ok(check.find((r) => r.nome === 'commerce_sales_summary_rows').original > 0, 'a cópia não é de tabela vazia');
  const base = await db.main.query(docSql('baseline'));
  assert.ok(base[1].rows.length >= 2, 'linha de base por plataforma/mês');
  assert.equal((await db.one(`select has_table_privilege('anon', 'backup.pre_ga019__commerce_sales_snapshots', 'select') ok`)).ok, false, 'cópia fechada para anon');
  await assert.rejects(db.main.query(docSql('backup')), /already exists/, 'rodar o backup duas vezes não sobrescreve nada em silêncio');
}, { beforeV2: true });

withDb('runbook: conferências depois da migração (v1 com trava, 2 gatilhos, 6 funções, reconciliação) e consulta do último commit', async (db) => {
  await seedV1(db);
  await applyV2Migration(db);
  const res = await db.main.query(docSql('postcheck'));
  assert.equal(res[0].rows[0].v1_com_trava, true);
  assert.equal(Number(res[1].rows[0].gatilhos_de_exclusao), 2);
  assert.equal(Number(res[2].rows[0].funcoes_v2), 6);
  assert.ok(Array.isArray(res[3].rows), 'a reconciliação roda');
  assert.deepEqual(await db.q(docSql('rollback-find')), [], 'sem commits v2 ainda');
}, { beforeV2: true });
