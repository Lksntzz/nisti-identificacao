import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('Catálogo Comercial usa namespace isolado no Supabase', () => {
  const schema = read('supabase/migrations/202609221205_commerce_catalog_v1.sql');
  const requiredTables = [
    'commerce_products',
    'commerce_product_skus',
    'commerce_marketplaces',
    'commerce_listings',
    'commerce_listing_products',
    'commerce_import_batches',
    'commerce_import_rows',
    'commerce_reconciliation_candidates',
    'commerce_update_campaigns',
    'commerce_update_items',
    'commerce_update_checks'
  ];

  for (const table of requiredTables) {
    assert.equal(schema.includes(`public.${table}`), true, `${table} precisa existir no schema`);
  }

  assert.equal(schema.includes('alter table public.products'), false);
  assert.equal(schema.includes('alter table public.product_platforms'), false);
});

test('SKU é entidade versionada e não campo duplicado no produto mestre', () => {
  const schema = read('supabase/migrations/202609221205_commerce_catalog_v1.sql');
  assert.equal(schema.includes('create table if not exists public.commerce_product_skus'), true);
  assert.equal(schema.includes("sku_type in ('CURRENT', 'HISTORICAL', 'ALIAS')"), true);
  assert.equal(schema.includes('commerce_product_skus_one_current_uq'), true);
  assert.equal(schema.includes('current_sku text'), false);
});

test('Tabelas comerciais não ficam expostas a anon/authenticated', () => {
  const schema = read('supabase/migrations/202609221205_commerce_catalog_v1.sql');
  assert.equal(schema.includes('enable row level security'), true);
  assert.equal(schema.includes('from anon, authenticated'), true);
  assert.equal(schema.includes('to service_role'), true);
});

test('API comercial passa pelo guard administrativo antes do handler', () => {
  const edge = read('src/edge-router.js');
  const guard = edge.indexOf('if (isProtectedApi(pathname)');
  const handlerCall = edge.lastIndexOf('handleCommerceAdminRequest(request, env)');
  assert.ok(guard >= 0, 'guard administrativo precisa existir');
  assert.ok(handlerCall > guard, 'handler comercial deve executar somente depois do guard');
  assert.equal(edge.includes("pathname.startsWith('/api/admin/')"), true);
});

test('Primeira API comercial é somente leitura', () => {
  const router = read('src/commerce-admin-router.js');
  assert.equal(router.includes("request.method !== 'GET'"), true);
  assert.equal(router.includes('/dashboard'), true);
  assert.equal(router.includes('/products'), true);
  assert.equal(router.includes('/listings'), true);
});
