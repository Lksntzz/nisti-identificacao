import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('RPC de detalhe multiplataforma existe em live e preview', () => {
  const sql = read('supabase/migrations/202609241425_commerce_product_platform_detail_v1.sql');
  assert.equal(sql.includes('commerce_product_platform_detail_v1'), true);
  assert.equal(sql.includes('commerce_preview_product_platform_detail_v1'), true);
  assert.equal(sql.includes("'marketplaces'"), true);
  assert.equal(sql.includes("'listings'"), true);
  assert.equal(sql.includes("'platform_sku'"), true);
  assert.equal(sql.includes("'variation_name'"), true);
});

test('detalhe multiplataforma preserva imagem específica e fallback NISTI ID', () => {
  const sql = read('supabase/migrations/202609241425_commerce_product_platform_detail_v1.sql');
  assert.equal(sql.includes("'MARKETPLACE_VARIATION'"), true);
  assert.equal(sql.includes("'MARKETPLACE'"), true);
  assert.equal(sql.includes("'NISTI_ID'"), true);
  assert.equal(sql.includes("'/api/images/'||media.source_product_id::text"), true);
});

test('store e router expõem detalhe por Produto Mestre', () => {
  const store = read('src/commerce-supabase-store.js');
  const router = read('src/commerce-admin-router.js');
  assert.equal(store.includes("'commerce_product_platform_detail_v1'"), true);
  assert.equal(store.includes('commerceProductDetail'), true);
  assert.equal(router.includes('/products\\/(\\d+)\\/details'), true);
});

test('Produtos Mestre usam cards com tags exclusivo e multiplataforma', () => {
  const view = read('src/commerce-products-view.jsx');
  assert.equal(view.includes("label: 'Exclusivo'"), true);
  assert.equal(view.includes("label: 'Multiplataforma'"), true);
  assert.equal(view.includes("label: 'Sem anúncio'"), true);
  assert.equal(view.includes('commerce-product-card-grid'), true);
  assert.equal(view.includes('Ver plataformas'), true);
});

test('clique no card abre painel com plataformas e dados do anúncio', () => {
  const view = read('src/commerce-products-view.jsx');
  assert.equal(view.includes('ProductPlatformDrawer'), true);
  assert.equal(view.includes('/products/${productId}/details'), true);
  assert.equal(view.includes('Informações da plataforma'), true);
  assert.equal(view.includes('ID da plataforma'), true);
  assert.equal(view.includes('SKU na plataforma'), true);
  assert.equal(view.includes('Última verificação'), true);
  assert.equal(view.includes('Abrir anúncio'), true);
});
