// GA-019 — identificação de pedidos por HMAC-SHA256 com chave secreta SÓ no servidor (Worker).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { hashOrderRefs, orderKeyHex, orderKeySecret, OrderKeySecretError, ORDER_KEY_VERSION } from '../src/ga/commerce-order-keys.js';
import { handleCommerceAdminRequest } from '../src/ga/commerce-admin-router.js';

const SECRET = 'segredo-de-teste-'.repeat(3);
const env = { SUPABASE_URL: 'https://fake.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', COMMERCE_ORDER_KEY_SECRET: SECRET };

test('chave do pedido = HMAC-SHA256(segredo, versão|plataforma|número) truncado em 32 hex', () => {
  const k = orderKeyHex(SECRET, 'SHOPEE', ' 2610AB123 ');
  const expected = crypto.createHmac('sha256', SECRET).update(`${ORDER_KEY_VERSION}|SHOPEE|2610AB123`).digest('hex').slice(0, 32);
  assert.equal(k, expected);
  assert.match(k, /^[0-9a-f]{32}$/);
  const unkeyed = crypto.createHash('sha256').update(`${ORDER_KEY_VERSION}|SHOPEE|2610AB123`).digest('hex').slice(0, 32);
  assert.notEqual(k, unkeyed, 'sem o segredo não dá para recalcular a chave (não é um hash simples)');
});

test('segredo, plataforma e número mudam a chave; mesmo conjunto dá a mesma chave', () => {
  const base = orderKeyHex(SECRET, 'SHOPEE', '123');
  assert.equal(orderKeyHex(SECRET, 'SHOPEE', '123'), base);
  assert.notEqual(orderKeyHex(SECRET + 'x', 'SHOPEE', '123'), base);
  assert.notEqual(orderKeyHex(SECRET, 'ML_NOVO', '123'), base);
  assert.notEqual(orderKeyHex(SECRET, 'SHOPEE', '124'), base);
});

test('sem segredo (ou segredo curto) o servidor se recusa a gerar chaves: falha fechada', () => {
  assert.throws(() => orderKeySecret({}), OrderKeySecretError);
  assert.throws(() => orderKeySecret({ COMMERCE_ORDER_KEY_SECRET: 'curto' }), OrderKeySecretError);
  assert.equal(orderKeySecret({ COMMERCE_ORDER_KEY_SECRET: SECRET }), SECRET);
});

test('hashOrderRefs: tira repetidos por dia, ordena e não devolve o número real', () => {
  const out = hashOrderRefs(SECRET, 'SHOPEE', [
    { d: '2026-10-02', o: 'B2' }, { d: '2026-10-01', o: 'A1' }, { d: '2026-10-01', o: 'A1' }, { d: '2026-10-01', o: ' A1 ' }]);
  assert.deepEqual(out.map((x) => x.d), ['2026-10-01', '2026-10-02']);
  assert.equal(JSON.stringify(out).includes('A1'), false);
  assert.equal(JSON.stringify(out).includes('B2'), false);
});

test('hashOrderRefs recusa entrada inválida', () => {
  assert.throws(() => hashOrderRefs(SECRET, 'SHOPEE', [{ d: '01/10/2026', o: 'A' }]), /inválid/);
  assert.throws(() => hashOrderRefs(SECRET, 'SHOPEE', [{ d: '2026-10-01', o: '' }]), /inválid/);
  assert.throws(() => hashOrderRefs(SECRET, 'SHOPEE', [{ d: '2026-10-01', o: 'x'.repeat(65) }]), /inválid/);
  assert.throws(() => hashOrderRefs(SECRET, 'OUTRA', [{ d: '2026-10-01', o: 'A' }]), /inválid/);
});

// ---------- rota real do servidor, com o banco simulado (só captura o que seria enviado) ----------

async function callRoute(path, body, e = env) {
  const calls = [];
  const realFetch = globalThis.fetch;
  const logs = [];
  const realLog = [console.log, console.warn, console.error, console.info];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify(2), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  for (const m of ['log', 'warn', 'error', 'info']) console[m] = (...a) => logs.push(a.map(String).join(' '));
  try {
    const res = await handleCommerceAdminRequest(new Request(`https://x.test${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), e);
    return { status: res.status, json: await res.json().catch(() => null), calls, logs };
  } finally {
    globalThis.fetch = realFetch;
    [console.log, console.warn, console.error, console.info] = realLog;
    ['log', 'warn', 'error', 'info'].forEach((m, i) => { console[m] = realLog[i]; });
  }
}

test('rota /orders: o banco só recebe chaves HMAC; o número real não é enviado, devolvido nem logado', async () => {
  const r = await callRoute('/api/admin/commerce/sales/imports/12/orders', {
    platform: 'SHOPEE', rows: [{ d: '2026-10-01', o: 'PEDIDO-SECRETO-1' }, { d: '2026-10-01', o: 'PEDIDO-SECRETO-2' }] });
  assert.equal(r.status, 200);
  assert.equal(r.calls.length, 1);
  assert.match(r.calls[0].url, /commerce_append_sales_import_orders_v2/);
  const sent = r.calls[0].body.p_rows;
  assert.equal(sent.length, 2);
  assert.ok(sent.every((x) => /^[0-9a-f]{32}$/.test(x.k) && x.d === '2026-10-01'));
  assert.equal(sent[0].k, orderKeyHex(SECRET, 'SHOPEE', 'PEDIDO-SECRETO-1'));
  const everything = JSON.stringify(r.calls) + JSON.stringify(r.json) + r.logs.join('\n');
  assert.equal(everything.includes('PEDIDO-SECRETO'), false, 'nenhum rastro do número real');
  assert.equal(everything.includes(SECRET), false, 'o segredo nunca aparece');
});

test('rota /orders sem segredo configurado falha fechada e não toca no banco', async () => {
  const r = await callRoute('/api/admin/commerce/sales/imports/12/orders',
    { platform: 'SHOPEE', rows: [{ d: '2026-10-01', o: 'PEDIDO-SECRETO-1' }] }, { ...env, COMMERCE_ORDER_KEY_SECRET: '' });
  assert.equal(r.status, 503);
  assert.equal(r.json.technical_error, 'order_key_secret_missing');
  assert.equal(r.calls.length, 0);
  assert.equal(JSON.stringify(r.json).includes('PEDIDO-SECRETO'), false);
});

test('rota /orders valida o lote (1 a 500 referências) e a plataforma', async () => {
  const many = Array.from({ length: 501 }, (_, i) => ({ d: '2026-10-01', o: `P${i}` }));
  assert.equal((await callRoute('/api/admin/commerce/sales/imports/12/orders', { platform: 'SHOPEE', rows: many })).status, 400);
  assert.equal((await callRoute('/api/admin/commerce/sales/imports/12/orders', { platform: 'SHOPEE', rows: [] })).status, 400);
  assert.equal((await callRoute('/api/admin/commerce/sales/imports/12/orders', { platform: 'XYZ', rows: [{ d: '2026-10-01', o: 'A' }] })).status, 400);
  assert.equal((await callRoute('/api/admin/commerce/sales/imports/12/orders', { platform: 'SHOPEE', rows: [{ d: 'x', o: 'A' }] })).status, 400);
});

test('rota /meta grava a data de geração do arquivo; data inválida é recusada', async () => {
  const ok = await callRoute('/api/admin/commerce/sales/imports/12/meta', { generated_at: '2026-10-05T18:30:00.000Z' });
  assert.equal(ok.status, 200);
  assert.match(ok.calls[0].url, /commerce_set_sales_import_meta_v2/);
  assert.deepEqual(ok.calls[0].body, { p_batch_id: 12, p_generated_at: '2026-10-05T18:30:00.000Z' });
  for (const bad of [undefined, null, 'ontem', '1999-01-01T00:00:00Z', 12345]) {
    const r = await callRoute('/api/admin/commerce/sales/imports/12/meta', { generated_at: bad });
    assert.equal(r.status, 400, String(bad));
    assert.equal(r.calls.length, 0);
  }
});

test('o segredo não está no repositório nem no código do navegador', () => {
  const wrangler = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.equal(wrangler.includes('COMMERCE_ORDER_KEY_SECRET'), false, 'segredo só no painel/secret do Cloudflare, nunca no wrangler.toml');
  const files = ['src/ga/commerce-sales-import-reader.js', 'src/ga/commerce-import-client.js', 'src/ga/commerce-ml-native-sales-reader.js', 'src/ga/commerce-import-center.jsx'];
  for (const f of files) {
    const code = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    assert.equal(code.includes('COMMERCE_ORDER_KEY_SECRET'), false, f);
    assert.equal(/createHmac|nisti-order-v/.test(code), false, `${f} não calcula chave de pedido`);
  }
});
