import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedRead, bumpReadCacheGeneration, isCacheableReadPath } from '../src/commerce-read-cache.js';

function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(req) { const v = store.get(req.url); return v ? new Response(v.body, { headers: v.headers }) : undefined; },
    async put(req, res) { store.set(req.url, { body: await res.text(), headers: [...res.headers] }); }
  };
}
const req = (path) => new Request('https://ga.example.com' + path);
const ok = (n) => () => Promise.resolve(new Response(JSON.stringify({ n }), { status: 200, headers: { 'content-type': 'application/json' } }));

test('Cache de leitura do GA: segunda leitura vem do cache e a alteração zera', async () => {
  const cache = fakeCache();
  let calls = 0;
  const produce = () => { calls += 1; return ok(calls)(); };
  const a = await cachedRead(req('/api/admin/commerce/sales-dashboard?days=30'), produce, { cache });
  assert.equal(a.headers.get('x-ga-cache'), null);
  const b = await cachedRead(req('/api/admin/commerce/sales-dashboard?days=30'), produce, { cache });
  assert.equal(b.headers.get('x-ga-cache'), 'HIT');
  assert.deepEqual(await b.json(), { n: 1 });
  assert.equal(calls, 1);
  await cachedRead(req('/api/admin/commerce/sales-dashboard?days=7'), produce, { cache });
  assert.equal(calls, 2, 'parâmetros diferentes não compartilham resposta');
  await new Promise(r => setTimeout(r, 2));
  await bumpReadCacheGeneration(cache);
  const c = await cachedRead(req('/api/admin/commerce/sales-dashboard?days=30'), produce, { cache });
  assert.equal(c.headers.get('x-ga-cache'), null);
  assert.equal(calls, 3, 'depois de uma alteração a leitura é refeita');
});

test('Cache de leitura do GA: fresh=1 ignora o cache e atualiza; erro não é guardado; sem cache funciona', async () => {
  const cache = fakeCache();
  let calls = 0;
  const produce = () => { calls += 1; return ok(calls)(); };
  await cachedRead(req('/x/sales-dashboard'), produce, { cache });
  const f = await cachedRead(req('/x/sales-dashboard?fresh=1'), produce, { cache });
  assert.equal(calls, 2);
  assert.deepEqual(await f.json(), { n: 2 });
  const again = await cachedRead(req('/x/sales-dashboard'), produce, { cache });
  assert.equal(again.headers.get('x-ga-cache'), 'HIT');
  assert.deepEqual(await again.json(), { n: 2 }, 'a leitura nova substitui a guardada');
  let errors = 0;
  const bad = () => { errors += 1; return Promise.resolve(new Response('{"error":"x"}', { status: 500 })); };
  await cachedRead(req('/x/sales-dashboard?e=1'), bad, { cache });
  await cachedRead(req('/x/sales-dashboard?e=1'), bad, { cache });
  assert.equal(errors, 2, 'resposta com erro nunca é guardada');
  const none = await cachedRead(req('/x/sales-dashboard'), produce, { cache: null });
  assert.equal(none.status, 200);
});

test('Cache de leitura do GA: só leituras do dashboard e das comparações', () => {
  const base = '/api/admin/commerce';
  assert.equal(isCacheableReadPath('GET', base + '/sales-dashboard', base), true);
  assert.equal(isCacheableReadPath('GET', base + '/sales-dashboard/abc', base), true);
  assert.equal(isCacheableReadPath('GET', base + '/sales-compare/categories', base), true);
  assert.equal(isCacheableReadPath('POST', base + '/sales-dashboard', base), false);
  assert.equal(isCacheableReadPath('GET', base + '/sales/imports', base), false);
  assert.equal(isCacheableReadPath('GET', base + '/management/products', base), false);
});
