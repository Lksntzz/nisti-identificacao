import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('listagem v4 reutiliza imagem do mesmo produto em outra plataforma', () => {
  const sql = read('supabase/migrations/202609241445_commerce_cross_platform_image_fallback_v1.sql');
  assert.equal(sql.includes('commerce_list_listings_v4'), true);
  assert.equal(sql.includes('commerce_preview_list_listings_v4'), true);
  assert.equal(sql.includes("'OTHER_MARKETPLACE'"), true);
  assert.equal(sql.includes('inherited_product_images jsonb'), true);
  assert.equal(sql.includes('lp2.product_id=target.product_id'), true);
});

test('foto própria mantém prioridade e NISTI ID continua como último fallback', () => {
  const sql = read('supabase/migrations/202609241445_commerce_cross_platform_image_fallback_v1.sql');
  const own = sql.indexOf('l.cover_image_url,');
  const inherited = sql.indexOf("inherited.images->0->>'image_url'");
  const nisti = sql.indexOf("nisti.images->0->>'image_url'");
  assert.ok(own >= 0);
  assert.ok(inherited > own);
  assert.ok(nisti > inherited);
});

test('detalhe do Produto Mestre herda imagem de outra plataforma sem copiar título', () => {
  const sql = read('supabase/migrations/202609241445_commerce_cross_platform_image_fallback_v1.sql');
  assert.equal(sql.includes('commerce_product_platform_detail_v2'), true);
  assert.equal(sql.includes('commerce_preview_product_platform_detail_v2'), true);
  assert.equal(sql.includes("'image_source_marketplace_name'"), true);
  assert.equal(sql.includes("'title',l.title"), true);
  assert.equal(sql.includes("'title',src_listing.title"), false);
});

test('UI identifica foto reutilizada do mesmo produto', () => {
  const products = read('src/commerce-products-view.jsx');
  const listings = read('src/commerce-listings-view.jsx');
  assert.equal(products.includes("listing.image_source === 'OTHER_MARKETPLACE'"), true);
  assert.equal(products.includes('Mesma foto do produto'), true);
  assert.equal(listings.includes("listing.cover_image_source === 'OTHER_MARKETPLACE'"), true);
  assert.equal(listings.includes('Mesma foto'), true);
  assert.equal(listings.includes('inherited_product_images'), true);
});
