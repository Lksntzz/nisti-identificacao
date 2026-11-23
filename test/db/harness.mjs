// Ambiente de teste do banco: sobe um Postgres 17 LOCAL e DESCARTÁVEL (grátis, só na máquina de quem roda),
// carrega o esquema mínimo fictício + a migração real da v2 e cria um banco novo por teste.
// Nunca toca o Supabase real. Rodar: `npm run test:db` (precisa de `npm install --no-save embedded-postgres pg`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export const MIGRATION = process.env.V2_MIGRATION_PATH || path.join(root, 'supabase/migrations/20261123210000_commerce_commit_sales_import_v2.sql');
const SCHEMA = path.join(here, 'fixtures/schema.sql');

let server = null;
let adminClient = null;
let templateReady = false;
let counter = 0;
let PgClient = null;
const PORT = 54000 + Math.floor(Math.random() * 900);

export async function startServer() {
  if (server) return;
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  ({ Client: PgClient } = (await import('pg')).default);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nisti-pg-'));
  fs.chmodSync(dir, 0o777); // o servidor pode rodar com outro usuário do sistema
  server = new EmbeddedPostgres({
    databaseDir: path.join(dir, 'data'), user: 'postgres', password: 'test', port: PORT, persistent: false,
    onLog: () => {}, onError: () => {}
  });
  await server.initialise();
  await server.start();
  adminClient = new PgClient({ host: 'localhost', port: PORT, user: 'postgres', password: 'test', database: 'postgres' });
  await adminClient.connect();
  await adminClient.query('create database tpl');
  const tpl = new PgClient({ host: 'localhost', port: PORT, user: 'postgres', password: 'test', database: 'tpl' });
  await tpl.connect();
  await tpl.query(fs.readFileSync(SCHEMA, 'utf8'));
  await tpl.query(fs.readFileSync(MIGRATION, 'utf8'));
  await tpl.end();
  templateReady = true;
}

export async function stopServer() {
  if (adminClient) await adminClient.end();
  if (server) await server.stop();
  server = null; adminClient = null; templateReady = false;
}

export async function newDb() {
  if (!templateReady) throw new Error('servidor de teste não iniciado');
  const name = `t_${process.pid}_${++counter}`;
  await adminClient.query(`create database ${name} template tpl`);
  const connect = async () => {
    const c = new PgClient({ host: 'localhost', port: PORT, user: 'postgres', password: 'test', database: name });
    await c.connect();
    return c;
  };
  const clients = [];
  const db = {
    name,
    async client() { const c = await connect(); clients.push(c); return c; },
    async close() { for (const c of clients) { try { await c.end(); } catch { /* já fechado */ } } }
  };
  db.main = await db.client();
  db.q = async (sql, params) => (await db.main.query(sql, params)).rows;
  db.one = async (sql, params) => (await db.q(sql, params))[0];
  return db;
}

// ---------- dados fictícios ----------
export const orderKey = (platform, orderId) =>
  crypto.createHash('md5').update(`${platform}|${orderId}`).digest('hex');

/**
 * Prepara um arquivo (lote STAGED) por DIA. days = { 'YYYY-MM-DD': [{ sku, units, rev, orders:['o1',...] }] }
 * created = instante de criação do lote (define se o último dia está completo).
 */
export async function stage(db, { platform = 'SHOPEE', file, created, days, finance }) {
  const b = await db.one(
    `insert into commerce_sales_import_batches(platform_code, source_filename, status, created_at)
     values ($1,$2,'STAGED',$3) returning id`, [platform, file, created]);
  let n = 0;
  const perDay = {};
  for (const [d, rows] of Object.entries(days)) {
    perDay[d] = { units: 0, rev: 0, keys: new Set(), skus: new Set() };
    for (const r of rows) {
      n += 1;
      await db.q(`insert into commerce_sales_import_stage_rows(batch_id, source_row_number, period_key, period_start, period_end,
        sku_primary, sku, sku_norm, units, orders_with_item, product_revenue) values ($1,$2,$3::text,$3::date,$3::date,$4,$4,$4,$5,$6,$7)`,
        [b.id, n, d, r.sku, r.units, r.orders.length, r.rev]);
      if (platform === 'SHOPEE') {
        await db.q(`insert into commerce_shopee_sales_sku_daily_v1(batch_id, sale_date, sku_norm, units, orders_with_item, product_revenue)
          values ($1,$2,$3,$4,$5,$6)`, [b.id, d, r.sku, r.units, r.orders.length, r.rev]);
      } else {
        await db.q(`insert into commerce_sales_listing_daily_v1(batch_id, sale_date, external_listing_id, sku_norm, units, orders_with_item, product_revenue)
          values ($1,$2,$3,$4,$5,$6,$7)`, [b.id, d, `L-${r.sku}`, r.sku, r.units, r.orders.length, r.rev]);
      }
      for (const o of r.orders) {
        const k = orderKey(platform, o);
        perDay[d].keys.add(k);
        await db.q(`insert into commerce_sales_import_stage_orders_v2(batch_id, sale_date, order_key) values ($1,$2,$3) on conflict do nothing`,
          [b.id, d, k]);
      }
      perDay[d].units += r.units; perDay[d].rev += r.rev; perDay[d].skus.add(r.sku);
    }
  }
  for (const [d, v] of Object.entries(perDay)) {
    await db.q(`insert into commerce_sales_import_stage_summary(batch_id, period_key, period_start, period_end, net_orders, units, product_revenue,
      listings_with_sales, skus_with_sales) values ($1,$2::text,$2::date,$2::date,$3,$4,$5,$6,$6)`,
      [b.id, d, v.keys.size, v.units, v.rev, v.skus.size]);
  }
  if (finance) {
    for (const f of finance.days || []) {
      await db.q(`insert into commerce_shopee_finance_stage_daily_v1(batch_id, sale_date, sku_norm, orders, units, product_revenue,
        seller_discount, commission_net, service_net, transaction_fee) values ($1,$2,$3,$4,$5,$6,0,$7,0,0)`,
        [b.id, f.date, f.sku, f.orders, f.units, f.rev, f.fee]);
    }
    for (const m of finance.months || []) {
      await db.q(`insert into commerce_shopee_finance_stage_month_v1(batch_id, month_start, orders, units, product_revenue, seller_discount,
        commission_net, service_net, transaction_fee, fee_orders, single_sku_fee_orders, unallocated_orders, unallocated_units, unallocated_revenue)
        values ($1,$2,$3,$4,$5,0,$6,0,0,$7,$8,$9,$10,$11)`,
        [b.id, m.month, m.orders, m.units, m.rev, m.fee, m.feeOrders, m.singleSku, m.unOrders || 0, m.unUnits || 0, m.unRev || 0]);
    }
  }
  return b.id;
}

export async function commit(db, id, client) {
  const r = await (client || db.main).query('select public.commerce_commit_sales_import_v2($1) r', [id]);
  return r.rows[0].r;
}

export async function commitError(db, id) {
  try { await commit(db, id); } catch (e) { return e; }
  return null;
}

/** Linha do resumo mensal no snapshot atual. */
export async function summary(db, platform, month) {
  return db.one(`select s.period_key, s.period_start::text ps, s.period_end::text pe, s.net_orders, s.units, s.product_revenue::float8 rev,
      s.skus_with_sales from commerce_sales_summary_rows s join commerce_sales_snapshots n on n.id = s.snapshot_id and n.is_current
    where s.platform_code = $1 and to_char(s.period_start,'YYYY-MM') = $2`, [platform, month]);
}

export async function rowsOf(db, platform, month) {
  return db.q(`select r.sku_norm sku, r.units, r.product_revenue::float8 rev, r.orders_with_item owi from commerce_sales_rows r
    join commerce_sales_snapshots n on n.id = r.snapshot_id and n.is_current
    where r.platform_code = $1 and to_char(r.period_start,'YYYY-MM') = $2 order by r.sku_norm`, [platform, month]);
}

/** Impressão digital do banco inteiro: se algo mudar (mesmo uma linha), muda. */
export async function fingerprint(db) {
  const tables = ['commerce_sales_snapshots', 'commerce_sales_import_batches', 'commerce_sales_rows', 'commerce_sales_summary_rows',
    'commerce_sales_import_stage_rows', 'commerce_sales_import_stage_summary', 'commerce_shopee_sales_sku_daily_v1',
    'commerce_sales_listing_daily_v1', 'commerce_shopee_finance_stage_daily_v1', 'commerce_shopee_finance_month_v1',
    'commerce_shopee_finance_daily_v1', 'commerce_shopee_sku_daily_superseded_v1', 'commerce_shopee_fin_daily_superseded_v1',
    'commerce_sales_import_stage_orders_v2', 'commerce_sales_day_coverage_v2'];
  const out = {};
  for (const t of tables) {
    // superseded_at/imported_at/committed_at variam sozinhos; os dados é que contam
    const r = await db.one(`select count(*)::int n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') h from (
      select to_jsonb(t) - 'superseded_at' - 'imported_at' as x from ${t} t) q`);
    out[t] = `${r.n}:${r.h}`;
  }
  out.version = (await db.one('select public.commerce_data_version_v1() v')).v;
  return out;
}

/** Estado antigo (v1): um mês Shopee mensal com dias em sku_daily. Retorna ids. */
export async function seedLegacyShopee(db, { file = 'Order.all.legacy.xlsx', month, through, days, blockOrders, committedAt, alsoSnapshot = true }) {
  const snap = await db.one(`insert into commerce_sales_snapshots(source_name, source_ref, is_current) values ('LEGACY','legacy',false) returning id`);
  const b = await db.one(`insert into commerce_sales_import_batches(platform_code, source_filename, status, snapshot_id, created_at, committed_at)
    values ('SHOPEE', $1, 'COMMITTED', $2, $3, $3) returning id`, [file, snap.id, committedAt]);
  const key = `${month} (01-${through.slice(8)})`;
  const sums = {};
  let n = 0;
  for (const [d, rows] of Object.entries(days)) {
    for (const r of rows) {
      await db.q(`insert into commerce_shopee_sales_sku_daily_v1(batch_id, sale_date, sku_norm, units, orders_with_item, product_revenue)
        values ($1,$2,$3,$4,$5,$6)`, [b.id, d, r.sku, r.units, r.orders.length, r.rev]);
      sums[r.sku] = sums[r.sku] || { units: 0, rev: 0, owi: 0 };
      sums[r.sku].units += r.units; sums[r.sku].rev += r.rev; sums[r.sku].owi += r.orders.length;
    }
  }
  const monthStart = `${month}-01`;
  for (const [sku, v] of Object.entries(sums)) {
    n += 1;
    await db.q(`insert into commerce_sales_import_stage_rows(batch_id, source_row_number, period_key, period_start, period_end, sku_primary, sku, sku_norm, units, orders_with_item, product_revenue)
      values ($1,$2,$3,$4,$5,$6,$6,$6,$7,$8,$9)`, [b.id, n, key, monthStart, through, sku, v.units, v.owi, v.rev]);
    await db.q(`insert into commerce_sales_rows(snapshot_id, source_row_number, platform_code, period_key, period_start, period_end, sku_primary, sku, sku_norm, units, orders_with_item, product_revenue)
      values ($1,$2,'SHOPEE',$3,$4,$5,$6,$6,$6,$7,$8,$9)`, [snap.id, n, key, monthStart, through, sku, v.units, v.owi, v.rev]);
  }
  const tu = Object.values(sums).reduce((a, v) => a + v.units, 0);
  const tr = Object.values(sums).reduce((a, v) => a + v.rev, 0);
  await db.q(`insert into commerce_sales_import_stage_summary(batch_id, period_key, period_start, period_end, net_orders, units, product_revenue)
    values ($1,$2,$3,$4,$5,$6,$7)`, [b.id, key, monthStart, through, blockOrders, tu, tr]);
  if (alsoSnapshot) {
    await db.q(`insert into commerce_sales_summary_rows(snapshot_id, platform_code, period_key, period_start, period_end, net_orders, units, product_revenue)
      values ($1,'SHOPEE',$2,$3,$4,$5,$6,$7)`, [snap.id, key, monthStart, through, blockOrders, tu, tr]);
    await db.q('update commerce_sales_snapshots set is_current = false');
    await db.q('update commerce_sales_snapshots set is_current = true, row_count = $2, summary_row_count = 1 where id = $1', [snap.id, n]);
  }
  return { snapshot: snap.id, batch: b.id };
}
