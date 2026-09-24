import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('fallback de mídia cruza SKU comercial CURRENT com SKU do NISTI ID', () => {
  const sql = read('supabase/migrations/202609241410_commerce_nisti_id_media_fallback_v1.sql');
  assert.equal(sql.includes('commerce_product_media_links'), true);
  assert.equal(sql.includes('commerce_preview_product_media_links'), true);
  assert.equal(sql.includes("upper(btrim(core.sku))=upper(btrim(cps.sku))"), true);
  assert.equal(sql.includes("cps.sku_type='CURRENT'"), true);
  assert.equal(sql.includes("core.image_key"), true);
});

test('fallback usa endpoint público de imagem do NISTI ID', () => {
  const sql = read('supabase/migrations/202609241410_commerce_nisti_id_media_fallback_v1.sql');
  assert.equal(sql.includes("'/api/images/' || media.source_product_id::text"), true);
  assert.equal(sql.includes("'NISTI_ID'"), true);
});

test('imagem de marketplace mantém prioridade sobre NISTI ID', () => {
  const sql = read('supabase/migrations/202609241410_commerce_nisti_id_media_fallback_v1.sql');
  assert.equal(sql.includes('coalesce(\n      p.thumbnail_url,'), true);
  assert.equal(sql.includes('when p.thumbnail_url is not null then \'MARKETPLACE\''), true);
  assert.equal(sql.includes('when l.cover_image_url is not null then \'MARKETPLACE\''), true);
});

test('anúncios com múltiplos produtos recebem galeria de fallback por SKU', () => {
  const sql = read('supabase/migrations/202609241410_commerce_nisti_id_media_fallback_v1.sql');
  assert.equal(sql.includes('fallback_product_images jsonb'), true);
  assert.equal(sql.includes("'product_id',x.product_id"), true);
  assert.equal(sql.includes("'sku',x.sku"), true);
  assert.equal(sql.includes("'image_url','/api/images/' || x.source_product_id::text"), true);
});

test('store comercial usa RPCs v3 e UI identifica mídia NISTI ID', () => {
  const store = read('src/commerce-supabase-store.js');
  const products = read('src/commerce-products-view.jsx');
  const listings = read('src/commerce-listings-view.jsx');
  assert.equal(store.includes("'commerce_list_products_v3'"), true);
  assert.equal(store.includes("'commerce_list_listings_v4'"), true);
  assert.equal(products.includes("product.thumbnail_source === 'NISTI_ID'"), true);
  assert.equal(listings.includes("listing.cover_image_source === 'NISTI_ID'"), true);
  assert.equal(listings.includes('fallback_product_images'), true);
});
