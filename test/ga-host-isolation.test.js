import assert from 'node:assert/strict';
import test from 'node:test';
import edgeRouter from '../src/edge-router.js';

const env = { GA_PASSWORD: 'senha-ga', ADMIN_PASSWORD: 'senha-admin', ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) } };
const get = (path, headers = {}) => edgeRouter.fetch(new Request(`https://ga.sistemanistiid.online${path}`, { headers }), env, {});

test('no endereço do GA o painel administrativo e o login do ADM não existem', async () => {
  for (const path of ['/admin', '/admin-login', '/admin-commerce', '/api/admin/products', '/api/scan']) {
    const res = await get(path);
    assert.notEqual(res.status, 200, path);
    assert.ok(!String(res.headers.get('location') || '').includes('/admin'), path);
  }
});

test('GA redireciona visitante sem sessão para o login próprio', async () => {
  const res = await get('/');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/ga-login$/);
});

test('cookie de sessão do ADM não abre a API do GA', async () => {
  const res = await get('/api/admin/commerce/health', { cookie: 'nisti_admin_session=qualquer.coisa' });
  assert.equal(res.status, 401);
});
