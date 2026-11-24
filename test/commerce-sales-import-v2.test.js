// GA-019 — importação de vendas por DIA. Leitor (comportamento real com .xlsx fictício) e fiação estática.
// O comportamento do banco é testado em test/db (npm run test:db).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeXlsx } from './helpers/make-xlsx.js';
import * as readerModule from '../src/ga/commerce-sales-import-reader.js';
const { readCommerceSalesXlsx, isToShipFilename } = readerModule;

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const HEAD = ['ID do pedido', 'Status do pedido', 'Hora do pagamento do pedido', 'Data de criação do pedido', 'Número de referência SKU', 'SKU', 'Quantidade', 'Subtotal do produto'];
const line = (id, date, sku, qty, rev) => [id, 'Concluído', `${date} 10:00`, `${date} 09:00`, sku, sku, qty, rev];
const shopeeFile = (rows, name = 'Order.all.xlsx') => new File([makeXlsx([HEAD, ...rows])], name);

test('Shopee: linhas e resumos saem por dia real do pedido, com pedidos únicos pelo ID', async () => {
  const parsed = await readCommerceSalesXlsx(shopeeFile([
    line('o1', '2026-10-01', 'AAA', 2, '20,00'), line('o1', '2026-10-01', 'BBB', 1, '20,00'),
    line('o2', '2026-10-02', 'AAA', 1, '10,00')]), 'SHOPEE');
  assert.deepEqual(parsed.summaries.map((s) => [s.period_key, s.period_start, s.period_end, s.net_orders]),
    [['2026-10-01', '2026-10-01', '2026-10-01', 1], ['2026-10-02', '2026-10-02', '2026-10-02', 1]]);
  assert.equal(parsed.rows.length, 3);
  assert.ok(parsed.rows.every((r) => r.period_start === r.period_end && r.period_key === r.period_start));
  assert.equal(parsed.summary.net_orders, 2, 'pedido com 2 SKUs conta 1; nunca soma de pedidos por SKU');
  assert.deepEqual(parsed.coverage, { start: '2026-10-01', end: '2026-10-02', days_with_sales: 2 });
});

test('Shopee: o leitor entrega referências (dia + número do pedido) só para o SERVIDOR embaralhar; não existe hash no navegador', async () => {
  const a = await readCommerceSalesXlsx(shopeeFile([line('123456789', '2026-10-01', 'AAA', 1, '10,00')]), 'SHOPEE');
  const b = await readCommerceSalesXlsx(shopeeFile([line('123456789', '2026-10-01', 'AAA', 1, '10,00'), line('987', '2026-10-02', 'AAA', 1, '10,00')], 'outro.xlsx'), 'SHOPEE');
  assert.deepEqual(a.order_refs, [{ d: '2026-10-01', o: '123456789' }]);
  assert.deepEqual(b.order_refs, [{ d: '2026-10-01', o: '123456789' }, { d: '2026-10-02', o: '987' }], 'por dia, sem repetição, em ordem');
  assert.equal(a.order_keys, undefined, 'o navegador não calcula chave nenhuma');
  assert.equal(readerModule.orderKeyHex, undefined, 'sem função de hash sem segredo no código do navegador');
  const { order_refs: _refs, ...rest } = a;
  assert.equal(JSON.stringify(rest).includes('123456789'), false, 'o número do pedido só existe em order_refs, nunca nas linhas/resumos');
});

test('o leitor devolve a data de modificação do arquivo (geração) em formato ISO', async () => {
  const f = new File([makeXlsx([HEAD, line('o1', '2026-10-01', 'AAA', 1, '10,00')])], 'Order.all.xlsx', { lastModified: Date.parse('2026-10-05T15:30:00-03:00') });
  const parsed = await readCommerceSalesXlsx(f, 'SHOPEE');
  assert.equal(parsed.file_modified_at, '2026-10-05T18:30:00.000Z');
});

test('Shopee: arquivo que atravessa dois meses não vira um período mensal único', async () => {
  const parsed = await readCommerceSalesXlsx(shopeeFile([
    line('o1', '2026-10-31', 'AAA', 1, '10,00'), line('o2', '2026-11-01', 'AAA', 1, '10,00')]), 'SHOPEE');
  assert.deepEqual(parsed.summaries.map((s) => s.period_key), ['2026-10-31', '2026-11-01']);
  assert.equal(parsed.data_through, '2026-11-01');
});

test('Shopee: sem data do pedido ou sem ID do pedido a importação para (nunca usa nome do arquivo)', async () => {
  await assert.rejects(readCommerceSalesXlsx(shopeeFile([['o1', 'Concluído', '2026-10-01 10:00', '', 'AAA', 'AAA', 1, '10,00']]), 'SHOPEE', '2026-10'), /sem data reconhecível/);
  await assert.rejects(readCommerceSalesXlsx(shopeeFile([line('', '2026-10-01', 'AAA', 1, '10,00')]), 'SHOPEE'), /sem identificador/);
});

test('Order.toship é recusado no leitor, no servidor e no banco', async () => {
  assert.equal(isToShipFilename('Order.toship.20261121.xlsx'), true);
  assert.equal(isToShipFilename('order.TOSHIP.xlsx'), true);
  assert.equal(isToShipFilename('Order.all.20261001_20261031.xlsx'), false);
  await assert.rejects(readCommerceSalesXlsx(shopeeFile([line('o1', '2026-10-01', 'AAA', 1, '10,00')], 'Order.toship.20261121.xlsx'), 'SHOPEE'), /Order\.toship/);
  assert.match(read('src/ga/commerce-admin-router.js'), /order\[\.\]toship/i);
  assert.match(read('supabase/migrations/20261123210000_commerce_commit_sales_import_v2.sql'), /sales_import_toship_blocked/);
});

const ML_HEAD = ['N.º de venda', 'Data de venda', 'Depósito', 'Estado', 'Descrição do status', 'Pacote de diversos produtos', 'Pertence a um kit',
  'Unidades', 'Receita por produtos (BRL)', 'Receita por acréscimo no preço (pago pelo comprador)', 'Taxa de parcelamento equivalente ao acréscimo',
  'Tarifa de venda e impostos (BRL)', 'Receita por envio (BRL)', 'Tarifas de envio (BRL)', 'Custo de envio por troca de produto',
  'Custo de envio com base nas medidas e peso declarados', 'Custo por diferenças nas medidas e no peso do pacote', 'Descontos e bônus',
  'Cancelamentos e reembolsos (BRL)', 'Total (BRL)', 'Mês de faturamento das suas tarifas', 'Pedido de compra', 'Venda por publicidade',
  'SKU', '# de anúncio', 'Loja oficial', 'Título do anúncio', 'Variação', 'Preço unitário de venda do anúncio (BRL)'];
const mlLine = (id, day, sku, ad, qty, price) => {
  const cells = Array.from({ length: 29 }, () => null);
  cells[0] = id; cells[1] = day; cells[3] = 'Entregue'; cells[7] = qty; cells[8] = price * qty; cells[23] = sku; cells[24] = ad; cells[26] = 'Item'; cells[28] = price;
  return cells;
};

test('Mercado Livre: referências de pedido por dia saem do leitor só em order_refs', async () => {
  const data = [['Vendas BR'], [], [], [], [], ['Vendas'], ML_HEAD,
    mlLine('2000001', '15 de outubro de 2026 17:40 hs.', 'MMM', 'MLB1', 1, 30),
    mlLine('2000002', '15 de outubro de 2026 18:00 hs.', 'MMM', 'MLB1', 2, 30),
    mlLine('2000003', '16 de outubro de 2026 09:00 hs.', 'NNN', 'MLB2', 1, 45)];
  const parsed = await readCommerceSalesXlsx(new File([makeXlsx(data, 'Vendas BR')], 'vendas.xlsx'), 'ML_NOVO');
  assert.equal(parsed.order_keys, undefined);
  assert.deepEqual(parsed.order_refs, [{ d: '2026-10-15', o: '2000001' }, { d: '2026-10-15', o: '2000002' }, { d: '2026-10-16', o: '2000003' }]);
  const { order_refs: _refs, ...rest } = parsed;
  assert.equal(JSON.stringify(rest).includes('2000001'), false);
  assert.equal(parsed.summaries.find((x) => x.period_key === '2026-10-15').net_orders, 2);
});

test('cliente envia as referências dos pedidos e a data do arquivo ANTES do commit e se recusa a seguir sem elas', () => {
  const client = read('src/ga/commerce-import-client.js');
  assert.ok(client.indexOf('/orders`') > 0 && client.indexOf('/orders`') < client.indexOf("phase: 'commit'"));
  assert.ok(client.indexOf('/meta`') > 0 && client.indexOf('/meta`') < client.indexOf("phase: 'commit'"));
  assert.match(client, /sem identificadores de pedido/);
  assert.match(client, /ORDER_REF_CHUNK_SIZE = 500/);
  assert.match(client, /order_refs/);
  assert.doesNotMatch(client, /order_keys/);
  assert.match(client, /file_modified_at/);
});

test('servidor: rota de pedidos, v2 no commit e na ativação financeira, erros claros', () => {
  const router = read('src/ga/commerce-admin-router.js');
  const store = read('src/ga/commerce-supabase-store.js');
  assert.match(router, /\\\/orders\$\//);
  assert.match(router, /orderKeySecret\(env\)/);
  assert.match(router, /hashOrderRefs\(secret, platform, refs\)/);
  assert.match(router, /commerceAppendSalesImportOrders\(env, batchId, platform, keys\)/);
  assert.match(router, /commerceSetSalesImportMeta\(env, batchId,/);
  for (const code of ['sales_import_toship_blocked', 'sales_import_orders_unresolved', 'sales_import_month_not_rebuildable',
    'sales_import_orders_required', 'sales_import_day_level_required', 'sales_import_orders_mismatch', 'sales_import_daily_mismatch',
    'sales_import_platform_mismatch', 'sales_import_generated_at_required', 'sales_import_reconciliation_failed', 'sales_import_delete_blocked_v2'])
    assert.ok(router.includes(code), code);
  assert.match(store, /'commerce_commit_sales_import_v2'/);
  assert.match(store, /'commerce_activate_shopee_finance_v2'/);
  assert.doesNotMatch(store, /'commerce_commit_sales_import_v1'/, 'a v1 fica só no banco, para reversão');
  assert.match(store, /commerce_append_sales_import_orders_v2/);
  assert.match(store, /p_platform: platform/);
  assert.match(store, /commerce_set_sales_import_meta_v2/);
});

const stripComments = (sql) => sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const fnBody = (sql, name) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `função ${name} existe`);
  const end = sql.indexOf('\n$fn$;', start);
  return sql.slice(start, end);
};

test('migração v2: v1 só recebe a trava global (nunca é redefinida por nome), permissões só service_role, RLS nas tabelas novas', () => {
  const code = stripComments(read('supabase/migrations/20261123210000_commerce_commit_sales_import_v2.sql'));
  assert.doesNotMatch(code, /create (or replace )?function public\.commerce_commit_sales_import_v1/i, 'a v1 não é reescrita aqui');
  assert.equal((code.match(/commerce_commit_sales_import_v1/g) || []).length, 1, 'a v1 só aparece no bloco que insere a trava');
  assert.match(code, /v1_lock_patch_pattern_not_found/, 'falha alto se a v1 mudar de formato');
  assert.doesNotMatch(code, /drop (function|table)/i);
  assert.match(code, /pg_advisory_xact_lock\(hashtextextended\('commerce_sales_commit', 2026\)\)/);
  for (const fn of ['commerce_append_sales_import_orders_v2(bigint, text, jsonb)', 'commerce_sales_day_winners_v2(text, date, date)',
    'commerce_sales_day_rows_v2(text, date, date)', 'commerce_sales_month_orders_v2(text, date)',
    'commerce_commit_sales_import_v2(bigint)', 'commerce_activate_shopee_finance_v2(bigint)',
    'commerce_set_sales_import_meta_v2(bigint, timestamptz)', 'commerce_rollback_sales_import_v2(bigint)',
    'commerce_sales_reconcile_v2(text)', 'commerce_sales_daily_source_v2(text, date, date)']) {
    assert.ok(code.includes(`revoke all on function public.${fn} from public, anon, authenticated;`), `revoke ${fn}`);
    assert.ok(code.includes(`grant execute on function public.${fn} to service_role;`), `grant ${fn}`);
  }
  for (const t of ['commerce_sales_import_stage_orders_v2', 'commerce_sales_day_coverage_v2', 'commerce_sales_import_meta_v2']) {
    assert.ok(code.includes(`alter table public.${t} enable row level security;`), `RLS ${t}`);
    assert.ok(code.includes(`revoke all on public.${t} from public, anon, authenticated;`), `revoke ${t}`);
  }
  assert.ok(code.includes("'commerce_sales_commit_log_v2'") && code.includes('enable row level security'), 'tabelas de apoio com RLS');
  assert.doesNotMatch(code, /security definer/i);
  assert.doesNotMatch(code, /grant [^;]* to (anon|authenticated|public)/i);
});

test('migração v2: só a REVERSÃO toca no cache; commit e ativação financeira nunca escrevem nele', () => {
  const code = stripComments(read('supabase/migrations/20261123210000_commerce_commit_sales_import_v2.sql'));
  assert.doesNotMatch(fnBody(code, 'commerce_commit_sales_import_v2'), /commerce_read_cache_v1/);
  assert.doesNotMatch(fnBody(code, 'commerce_activate_shopee_finance_v2'), /commerce_read_cache_v1/);
  assert.match(fnBody(code, 'commerce_rollback_sales_import_v2'), /commerce_read_cache_v1/);
  const store = read('src/ga/commerce-supabase-store.js');
  const body = store.slice(store.indexOf('export async function commerceCommitSalesImport'));
  assert.ok(body.indexOf("'commerce_commit_sales_import_v2'") < body.indexOf('refreshShopeeYearAliases'));
});

test('a migração não remove nenhum indicador: a view mensal financeira da Shopee não é alterada', () => {
  const code = stripComments(read('supabase/migrations/20261123210000_commerce_commit_sales_import_v2.sql'));
  assert.doesNotMatch(code, /(create|replace)[^;]*view public\.commerce_shopee_finance_current_month_v1/i);
  assert.match(code, /create or replace view public\.commerce_shopee_finance_month_visibility_v2/);
});

test('CI: test:db é verificação obrigatória do Production Gate (Postgres descartável, ações fixadas por SHA, sem recurso pago)', () => {
  const gate = read('.github/workflows/production-gate.yml');
  assert.match(gate, /\n  database:\n/);
  assert.match(gate, /npm run test:db:install/);
  assert.match(gate, /npm run test:db\b(?!:)/);
  const dbJob = gate.slice(gate.indexOf('\n  database:\n'));
  for (const m of dbJob.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `ação fixada por SHA: ${m[1]}`);
  assert.doesNotMatch(dbJob, /supabase|SUPABASE|secrets\./i, 'o job de banco não usa Supabase nem segredos');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['test:db:install'], 'npm ci --prefix test/db --no-audit --no-fund');
  assert.equal(pkg.dependencies['embedded-postgres'], undefined, 'dependências do banco de teste não entram no build de produção');
  assert.equal(pkg.devDependencies['embedded-postgres'], undefined);
  const dbPkg = JSON.parse(read('test/db/package.json'));
  assert.deepEqual(Object.keys(dbPkg.dependencies).sort(), ['embedded-postgres', 'pg']);
  assert.ok(Object.values(dbPkg.dependencies).every((v) => /^\d/.test(v)), 'versões exatas, sem ^ ou ~');
});
