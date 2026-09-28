import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('frontend carrega apenas o Catálogo Comercial', () => {
  const entry = read('src/entry.jsx');
  assert.equal(entry.includes('CommerceAdminAppV2'), true);
  assert.equal(entry.includes('public-main'), false);
  assert.equal(entry.includes('main.jsx'), false);
  assert.equal(entry.includes('shadow-confirmation'), false);
});

test('menu comercial expõe somente as três áreas operacionais', () => {
  const app = read('src/commerce-admin-app-v2.jsx');
  for (const label of ['Gestão', 'Produtos Mestre', 'Anúncios']) {
    assert.equal(app.includes(`label: '${label}'`), true);
  }
  for (const legacy of ['Shopee · Capas', 'Importações Excel', 'Revisão de vínculos', 'Atualização Anual', 'Visão Geral']) {
    assert.equal(app.includes(legacy), false);
  }
});

test('worker não carrega reconhecimento, GTIN, D1, R2 ou Vectorize', () => {
  const edge = read('src/edge-router.js');
  const wrangler = read('wrangler.toml');

  for (const legacy of ['gtin-router', 'vectorize', 'gemini', 'geometric-shadow', 'recognition']) {
    assert.equal(edge.toLowerCase().includes(legacy), false);
  }
  assert.equal(wrangler.includes('[[d1_databases]]'), false);
  assert.equal(wrangler.includes('[[r2_buckets]]'), false);
  assert.equal(wrangler.includes('[[vectorize]]'), false);
  assert.equal(wrangler.includes('GEMINI_'), false);
  assert.equal(wrangler.includes('main = "src/edge-router.js"'), true);
});

test('API comercial mantém somente rotas usadas pela interface atual', () => {
  const router = read('src/commerce-admin-router.js');

  for (const active of [
    'management/products',
    'management/product-summary',
    'link-review',
    'products',
    'listings'
  ]) {
    assert.equal(router.includes(active), true);
  }

  for (const removed of ['/imports', '/reconciliation', '/shopee-snapshot', '/dashboard']) {
    assert.equal(router.includes(removed), false);
  }
});

test('Supabase é a única fonte operacional do runtime comercial', () => {
  const store = read('src/commerce-supabase-store.js');
  const readStore = read('src/supabase-read-store.js');

  assert.equal(store.includes("from './commerce-rpc.js'"), true);
  assert.equal(readStore.includes('/rest/v1/rpc/'), true);
  assert.equal(readStore.includes('preferSupabaseRead'), false);
  assert.equal(readStore.includes('d1'), false);
});
