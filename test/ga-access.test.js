import test from 'node:test';
import assert from 'node:assert/strict';
import { GA_HOST, handleGaHostRequest, createGaSession, validGaSession, isGaApiPath } from '../src/ga-access.js';

const env = {
  GA_PASSWORD: 'senha-ga', GA_SESSION_SECRET: 'segredo',
  ADMIN_PASSWORD: 'senha-admin',
  ASSETS: { fetch: async req => new URL(req.url).pathname === '/assets/app.js'
    ? new Response('js', { headers: { 'content-type': 'text/javascript' } })
    : new Response('<html>spa</html>', { headers: { 'content-type': 'text/html' } }) }
};
const calls = [];
const nextApi = async req => { calls.push(new URL(req.url).pathname); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); };
const run = (path, init = {}, e = env) => handleGaHostRequest(new Request(`https://${GA_HOST}${path}`, init), e, { nextApi });
const cookieOf = async () => `__Host-nisti_ga_session=${await createGaSession(env)}`;

test('sem GA_PASSWORD configurado, bloqueia tudo com 503', async () => {
  assert.equal((await run('/', {}, { ...env, GA_PASSWORD: '' })).status, 503);
});

test('raiz sem sessão redireciona para /ga-login e mostra a marca GA', async () => {
  const res = await run('/');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/ga-login$/);
  const login = await (await run('/ga-login')).text();
  assert.match(login, /GA - Gestor de Anúncio/);
});

test('API exige sessão do GA e só aceita rotas comerciais', async () => {
  assert.equal((await run('/api/admin/commerce/health')).status, 401);
  const cookie = await cookieOf();
  assert.equal((await run('/api/admin/commerce/health', { headers: { cookie } })).status, 200);
  assert.equal((await run('/api/admin/products', { headers: { cookie } })).status, 404);
  assert.equal((await run('/api/scan', { headers: { cookie } })).status, 404);
  assert.equal(isGaApiPath('/api/images/1', 'GET'), true);
  assert.equal(isGaApiPath('/api/images/1', 'POST'), false);
});

test('sessão do painel administrativo NÃO vale no GA', async () => {
  const forged = '__Host-nisti_ga_session=abc.def';
  assert.equal(await validGaSession(new Request(`https://${GA_HOST}/`, { headers: { cookie: forged } }), env), false);
  assert.equal(await validGaSession(new Request(`https://${GA_HOST}/`, { headers: { cookie: 'nisti_admin_session=abc.def' } }), env), false);
});

test('login: senha errada falha, senha certa cria cookie próprio', async () => {
  const page = await run('/ga-login');
  const csrf = /__Host-nisti_ga_csrf=([^;]+)/.exec(page.headers.get('set-cookie'))[1];
  const post = password => run('/ga-login', { method: 'POST', headers: { cookie: `__Host-nisti_ga_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf_token: csrf, password }) });
  assert.equal((await post('errada')).status, 401);
  const ok = await post('senha-ga');
  assert.equal(ok.status, 302);
  assert.match(ok.headers.get('set-cookie'), /^__Host-nisti_ga_session=.+HttpOnly; Secure; SameSite=Strict/);
  const nullOrigin = await run('/ga-login', { method: 'POST', headers: { origin: 'null', 'sec-fetch-site': 'same-origin', cookie: `__Host-nisti_ga_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf_token: csrf, password: 'senha-ga' }) });
  assert.equal(nullOrigin.status, 302);
  const crossSite = await run('/ga-login', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site', cookie: `__Host-nisti_ga_csrf=${csrf}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf_token: csrf, password: 'senha-ga' }) });
  assert.equal(crossSite.status, 403);
  const noCsrf = await run('/ga-login', { method: 'POST', body: new URLSearchParams({ password: 'senha-ga' }) });
  assert.equal(noCsrf.status, 403);
});

test('tela do app só com sessão; fallback HTML nunca expõe outra tela', async () => {
  const cookie = await cookieOf();
  assert.equal((await run('/', { headers: { cookie } })).status, 200);
  const asset = await run('/assets/app.js');
  assert.equal(asset.status, 200);
  const admin = await run('/admin');
  assert.equal(admin.status, 302);
  assert.match(admin.headers.get('location'), /\/$/);
});

test('logout só por POST', async () => {
  assert.equal((await run('/ga-logout')).status, 405);
  const out = await run('/ga-logout', { method: 'POST' });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
});
