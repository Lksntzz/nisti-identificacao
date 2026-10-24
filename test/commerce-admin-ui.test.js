import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('menu administrativo expõe o Catálogo como árvore de ferramentas no painel principal', () => {
  const nav = read('src/admin-navigation.js');
  assert.equal(nav.includes("title: 'COMERCIAL'"), true);
  assert.equal(nav.includes("label: 'Painel Comercial'"), true);
  assert.equal(nav.includes("id: 'sales'"), false);
  assert.equal(nav.includes("id: 'import-center'"), false);
  assert.equal(nav.includes("id: 'pending'"), true);
  assert.equal(nav.includes("href: '/admin-commerce'"), false);
});

test('menu principal mantém as ferramentas comerciais dentro de /admin', () => {
  const main = read('src/main.jsx');
  assert.equal(main.includes("window.location.href = '/admin-commerce'"), false);
  assert.equal(main.includes("activeView === 'commerce'"), true);
  assert.equal(main.includes("commerceSection === 'catalog'"), true);
  assert.equal(main.includes("commerceSection === 'sales'"), true);
  assert.equal(main.includes("commerceSection === 'import-center'"), false);
  assert.equal(main.includes("commerceSection === 'pending'"), true);
});

test('entry resolve /admin-commerce antes do prefixo genérico /admin', () => {
  const entry = read('src/entry.jsx');
  const commerce = entry.indexOf("window.location.pathname === '/admin-commerce'");
  const admin = entry.indexOf("pathname === '/admin'");
  const adminSubroutes = entry.indexOf("pathname.startsWith('/admin/')");
  assert.ok(commerce >= 0);
  assert.ok(admin > commerce);
  assert.ok(adminSubroutes > admin);
  assert.equal(entry.includes("import('./commerce-admin-app-v2.jsx')"), true);
});

test('rota do Catálogo Comercial reutiliza a sessão administrativa', () => {
  const edge = read('src/edge-router.js');
  assert.equal(edge.includes("const COMMERCE_ADMIN_APP_PATH = '/admin-commerce'"), true);
  assert.equal(edge.includes('serveProtectedAdminApp(request, env, url)'), true);
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

