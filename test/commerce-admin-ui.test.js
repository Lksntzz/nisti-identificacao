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
  assert.equal(entry.includes("import('./commerce-admin-app-v2.jsx')"), true);
});

test('rota do Catálogo Comercial reutiliza a sessão administrativa', () => {
  const edge = read('src/edge-router.js');
  assert.equal(edge.includes("const COMMERCE_ADMIN_APP_PATH = '/admin-commerce'"), true);
  assert.equal(edge.includes('serveProtectedAdminApp(request, env, url)'), true);
  assert.equal(edge.includes("pathname.startsWith('/api/admin/')"), true);
});

test('UI comercial modular possui as cinco visões essenciais', () => {
  const shell = read('src/commerce-admin-app-v2.jsx');
  for (const label of ['Visão Geral', 'Produtos Mestre', 'Anúncios', 'Importações Excel', 'Atualização Anual']) {
    assert.equal(shell.includes(label), true, `${label} deve existir`);
  }
  assert.equal(shell.includes('CommerceImportView'), true);
  assert.equal(shell.includes('CommerceProductsView'), true);
  assert.equal(shell.includes('CommerceListingsView'), true);
});

test('importação XLSX é browser-side, versionada e usa staging antes do commit', () => {
  const reader = read('src/commerce-xlsx-reader.js');
  const client = read('src/commerce-import-client.js');
  const view = read('src/commerce-import-view.jsx');
  const pkg = JSON.parse(read('package.json'));

  assert.equal(pkg.dependencies['read-excel-file'], '9.3.10');
  assert.equal(reader.includes("from 'read-excel-file/browser'"), true);
  assert.equal(reader.includes('crypto.subtle.digest'), true);
  assert.equal(reader.includes('COMMERCE_XLSX_MAX_BYTES'), true);
  assert.equal(client.includes('/imports/${batchId}/rows'), true);
  assert.equal(client.includes('/finalize'), true);
  assert.equal(client.includes('/reconcile'), true);
  assert.equal(client.includes('/commit'), true);
  assert.equal(view.includes('Criar lote e reconciliar'), true);
  assert.equal(view.includes('Commitar catálogo'), true);
});

test('cliente comercial confirma estado antes de tratar timeout de mutação como falha', () => {
  const client = read('src/commerce-import-client.js');
  assert.equal(client.includes('recoverBatchAfterRetryableError'), true);
  assert.equal(client.includes("['PARSED', 'REVIEW', 'COMMITTED']"), true);
  assert.equal(client.includes("['REVIEW', 'COMMITTED']"), true);
  assert.equal(client.includes("['COMMITTED']"), true);
  assert.equal(client.includes('recovered_after_timeout'), true);
});
