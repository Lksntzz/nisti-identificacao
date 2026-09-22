import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('menu administrativo expõe o Catálogo Comercial como módulo protegido', () => {
  const nav = read('src/admin-navigation.js');
  assert.equal(nav.includes("title: 'COMERCIAL'"), true);
  assert.equal(nav.includes("href: '/admin-commerce'"), true);
});

test('entry resolve /admin-commerce antes do prefixo genérico /admin', () => {
  const entry = read('src/entry.jsx');
  const commerce = entry.indexOf("window.location.pathname === '/admin-commerce'");
  const admin = entry.indexOf("window.location.pathname.startsWith('/admin')");
  assert.ok(commerce >= 0);
  assert.ok(admin > commerce);
  assert.equal(entry.includes("import('./commerce-admin-app.jsx')"), true);
});

test('rota do Catálogo Comercial reutiliza a sessão administrativa', () => {
  const edge = read('src/edge-router.js');
  assert.equal(edge.includes("const COMMERCE_ADMIN_APP_PATH = '/admin-commerce'"), true);
  assert.equal(edge.includes('serveProtectedAdminApp(request, env, url)'), true);
  assert.equal(edge.includes("pathname.startsWith('/api/admin/')"), true);
});

test('UI comercial possui visões essenciais da V1', () => {
  const source = read('src/commerce-admin-app.jsx');
  for (const label of ['Visão Geral', 'Produtos Mestre', 'Anúncios', 'Importações Excel', 'Atualização Anual']) {
    assert.equal(source.includes(label), true, `${label} deve existir`);
  }
  assert.equal(source.includes('/api/admin/commerce/dashboard'), true);
  assert.equal(source.includes('/api/admin/commerce/products'), true);
  assert.equal(source.includes('/api/admin/commerce/listings'), true);
});
