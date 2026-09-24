import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('snapshot Shopee possui tabelas live/preview e staging para itens novos', () => {
  const sql = read('supabase/migrations/202609241335_commerce_shopee_snapshot_media_v1.sql');
  assert.equal(sql.includes('commerce_marketplace_snapshots'), true);
  assert.equal(sql.includes('commerce_preview_marketplace_snapshots'), true);
  assert.equal(sql.includes("'NEW_PENDING'"), true);
  assert.equal(sql.includes("'MATCHED'"), true);
  assert.equal(sql.includes("'CONFLICT'"), true);
});

test('ingestão Shopee atualiza anúncio existente sem inferir estado comercial', () => {
  const sql = read('supabase/migrations/202609241335_commerce_shopee_snapshot_media_v1.sql');
  assert.equal(sql.includes('commerce_ingest_shopee_snapshot_v1'), true);
  assert.equal(sql.includes('commerce_preview_ingest_shopee_snapshot_v1'), true);
  assert.equal(sql.includes('cover_image_url'), true);
  assert.equal(sql.includes('variation_options'), true);
  assert.equal(sql.includes('listing_status ='), false);
  assert.equal(sql.includes('sales_status ='), false);
});

test('RPCs v2 expõem miniaturas sem mudar contrato de identidade Produto Mestre', () => {
  const sql = read('supabase/migrations/202609241335_commerce_shopee_snapshot_media_v1.sql');
  assert.equal(sql.includes('commerce_list_products_v2'), true);
  assert.equal(sql.includes('commerce_list_listings_v2'), true);
  assert.equal(sql.includes('thumbnail_url text'), true);
  assert.equal(sql.includes('variation_options jsonb'), true);
});

test('store e router expõem snapshot Shopee protegido', () => {
  const store = read('src/commerce-supabase-store.js');
  const router = read('src/commerce-admin-router.js');
  assert.equal(store.includes("'commerce_list_products_v3'"), true);
  assert.equal(store.includes("'commerce_list_listings_v3'"), true);
  assert.equal(store.includes("'commerce_list_shopee_snapshot_v1'"), true);
  assert.equal(router.includes('/shopee-snapshot'), true);
});

test('UI comercial exibe galeria Shopee e miniaturas em produtos e anúncios', () => {
  const app = read('src/commerce-admin-app-v2.jsx');
  const view = read('src/commerce-shopee-snapshot-view.jsx');
  const products = read('src/commerce-products-view.jsx');
  const listings = read('src/commerce-listings-view.jsx');
  assert.equal(app.includes("id: 'shopee'"), true);
  assert.equal(app.includes('CommerceShopeeSnapshotView'), true);
  assert.equal(view.includes('Shopee · Capas e variações'), true);
  assert.equal(view.includes('variation_options'), true);
  assert.equal(products.includes('product.thumbnail_url'), true);
  assert.equal(listings.includes('listing.cover_image_url'), true);
  assert.equal(listings.includes('listing.variation_options'), true);
});
