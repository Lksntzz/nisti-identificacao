import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('menu administrativo do NISTI ID não tem mais o Painel Comercial', () => {
  const nav = read('src/admin-navigation.js');
  assert.equal(nav.includes("title: 'COMERCIAL'"), false);
  assert.equal(nav.includes("label: 'Painel Comercial'"), false);
  const main = read('src/main.jsx');
  assert.equal(main.includes("activeView === 'commerce'"), false);
  assert.equal(main.includes('commerce-management-view'), false);
});

test('/admin-commerce não existe mais no NISTI ID e o GA monta o Painel Comercial', () => {
  const entry = read('src/entry.jsx');
  assert.equal(entry.includes("window.location.pathname === '/admin-commerce'"), false);
  assert.equal(entry.includes("if (IS_GA_HOST) return 'commerce'"), true);
  assert.equal(entry.includes("import('./commerce-admin-app-v2.jsx')"), true);
});

test('rota antiga /admin-commerce responde 404 no NISTI ID', () => {
  const edge = read('src/edge-router.js');
  assert.equal(edge.includes("const COMMERCE_ADMIN_APP_PATH = '/admin-commerce'"), true);
  assert.equal(edge.includes('Esta URL não existe neste sistema.'), true);
  assert.equal(edge.includes("pathname.startsWith('/api/admin/')"), true);
});

test('cliente comercial confirma estado antes de tratar timeout de mutação como falha', () => {
  const client = read('src/commerce-import-client.js');
  assert.equal(client.includes('recoverBatchAfterRetryableError'), true);
  assert.equal(client.includes("['PARSED', 'REVIEW', 'COMMITTED']"), true);
  assert.equal(client.includes("['REVIEW', 'COMMITTED']"), true);
  assert.equal(client.includes("['COMMITTED']"), true);
  assert.equal(client.includes('recovered_after_timeout'), true);
});

