import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('product state RPC valida estados e existe em live e preview', () => {
  const sql = read('supabase/migrations/202609241320_commerce_product_state_review_v1.sql');
  assert.equal(sql.includes('commerce_set_product_state_v1'), true);
  assert.equal(sql.includes('commerce_preview_set_product_state_v1'), true);
  assert.equal(sql.includes("('DRAFT', 'ACTIVE', 'DISCONTINUED')"), true);
  assert.equal(sql.includes('commerce_product_state_events'), true);
  assert.equal(sql.includes('commerce_preview_product_state_events'), true);
});

test('product state RPC é service-role only', () => {
  const sql = read('supabase/migrations/202609241320_commerce_product_state_review_v1.sql');
  assert.equal(sql.includes('from public, anon, authenticated'), true);
  assert.equal(sql.includes('to service_role'), true);
});

test('rota de estado do Produto Mestre passa pela proteção administrativa', () => {
  const edge = read('src/edge-router.js');
  const guard = edge.indexOf('if (isProtectedApi(pathname)');
  const productHandler = edge.indexOf('handleCommerceProductStateRequest(request, env)');
  const genericHandler = edge.indexOf('handleCommerceAdminRequest(request, env)');
  assert.ok(guard >= 0);
  assert.ok(productHandler > guard);
  assert.ok(genericHandler > productHandler);
});

test('UI de Produtos Mestre permite revisão manual sem exclusão de histórico', () => {
  const view = read('src/commerce-products-view.jsx');
  assert.equal(view.includes('Salvar revisão'), true);
  assert.equal(view.includes('/products/${productId}/state'), true);
  assert.equal(view.includes('DISCONTINUED'), true);
  assert.equal(view.includes('setStateProduct(product)'), true);
});

test('store de status usa RPC comercial com escopo live/preview', () => {
  const store = read('src/commerce-product-state-store.js');
  assert.equal(store.includes('commerce_set_product_state_v1'), true);
  assert.equal(store.includes('p_internal_status'), true);
  assert.equal(store.includes('p_checked_by'), true);
});
