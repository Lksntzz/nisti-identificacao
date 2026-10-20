import test from 'node:test';
import assert from 'node:assert/strict';
import edgeRouter from '../src/edge-router.js';

test('login administrativo adapta layout no celular sem ampliar o formulário',async()=>{
  const response=await edgeRouter.fetch(new Request('https://nisti-identificacao.lksntz1411.workers.dev/admin-login'),{
    APP_ENV:'test',
    ADMIN_PASSWORD:'test-only-admin-secret'
  },{});
  assert.equal(response.status,200);
  assert.match(response.headers.get('cache-control')||'',/no-store/);
  const body=await response.text();
  assert.match(body,/name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.match(body,/@media\(max-width:600px\)/);
  assert.match(body,/align-items:flex-start/);
  assert.match(body,/padding:clamp\(25px,7svh,58px\)/);
  assert.match(body,/font-size:16px/); // evita zoom automático do campo no iOS
  assert.match(body,/class="card" aria-labelledby="login-title"/);
  assert.match(body,/class="password" id="admin-password"/);
  assert.match(body,/class="submit" type="submit"/);
});

test('formulário administrativo mantém POST, proteção CSRF e senha no servidor',async()=>{
  const response=await edgeRouter.fetch(new Request('https://nisti-identificacao.lksntz1411.workers.dev/admin-login'),{
    APP_ENV:'test',
    ADMIN_PASSWORD:'test-only-admin-secret'
  },{});
  const body=await response.text();
  const cookie=response.headers.get('set-cookie')||'';
  assert.match(cookie,/__Host-nisti_login_csrf=/);
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.match(body,/method="post" action="\/admin-login"/);
  assert.match(body,/name="csrf_token" value="[A-Za-z0-9_-]{43}"/);
  assert.match(body,/type="password" name="password"/);
  assert.match(body,/autocomplete="current-password"/);
  assert.doesNotMatch(body,/<script\b|https:\/\/.*\.js/);
});

test('desktop mostra apresentação institucional e formulário em duas colunas; tablet e celular mantém login compacto',async()=>{
  const response=await edgeRouter.fetch(new Request('https://nisti-identificacao.lksntz1411.workers.dev/admin-login'),{
    APP_ENV:'test',
    ADMIN_PASSWORD:'test-only-admin-secret'
  },{});
  const body=await response.text();
  assert.match(body,/<div class="login-shell">/);
  assert.match(body,/<aside class="intro-panel" aria-label="Apresentação do NISTI ID">/);
  assert.match(body,/grid-template-columns:minmax\(0,\.88fr\) minmax\(0,1\.12fr\)/);
  assert.match(body,/@media\(min-width:821px\)/);
  assert.match(body,/\.intro-panel\{display:none\}/);
  assert.match(body,/<main class="card" aria-labelledby="login-title">/);
  assert.match(body,/<h1 id="login-title">Área administrativa<\/h1>/);
  assert.match(body,/@media\(max-width:600px\)/);
  assert.match(body,/padding:clamp\(25px,7svh,58px\)/);
  assert.equal((body.match(/<form method="post" action="\/admin-login">/g)||[]).length,1);
  assert.equal((body.match(/name="password"/g)||[]).length,1);
});
