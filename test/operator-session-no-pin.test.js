import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import app from '../src/edge-router.js';

// Sem PIN: o operador entra direto; o servidor ainda emite uma sessão anônima
// assinada por aparelho e nunca confia em x-user-id enviado pelo navegador.
const env = { ADMIN_PASSWORD: 'x', APP_ENV: 'test',
  ASSETS: { fetch: async () => new Response('<html>spa</html>', { headers: { 'content-type': 'text/html' } }) } };

test('operador acessa a API sem PIN e recebe sessão anônima assinada', async () => {
  const res = await app.fetch(new Request('https://t.local/api/platforms'), env, { waitUntil() {} });
  assert.notEqual(res.status, 401);
  const body = await res.text();
  assert.doesNotMatch(body, /operator_pin_required/);
});

test('x-user-id inventado pelo navegador é substituído pelo id da sessão do servidor', async () => {
  const edge = fs.readFileSync('src/edge-router.js', 'utf8');
  assert.match(edge, /if\(session\?\.id\)headers\.set\('x-user-id',session\.id\);\s*else headers\.delete\('x-user-id'\);/);
  assert.match(edge, /headers\.delete\('x-operator-verified'\)/);
  assert.match(edge, /if\(!\/\^op_\[0-9a-f-\]\{36\}\$\/i\.test\(id\)\)return null;/);
});

test('rotas de PIN e o painel de PIN foram removidos', async () => {
  for (const [method, path] of [['POST', '/api/operator/login'], ['GET', '/api/operator/session']]) {
    const res = await app.fetch(new Request('https://t.local' + path, { method,
      headers: { origin: 'https://t.local', 'sec-fetch-site': 'same-origin' } }), env, { waitUntil() {} });
    assert.doesNotMatch(await res.text(), /PIN/, path);
  }
  assert.equal(fs.existsSync('src/operator-pin-access.js'), false);
  assert.equal(fs.existsSync('src/operator-pin-gate.jsx'), false);
  assert.doesNotMatch(fs.readFileSync('src/admin-navigation.js', 'utf8'), /operadores-pin/);
  assert.doesNotMatch(fs.readFileSync('src/entry.jsx', 'utf8'), /OperatorPinGate/);
});
