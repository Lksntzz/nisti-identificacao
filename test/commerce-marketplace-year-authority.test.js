import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const migration = 'supabase/migrations/202609241530_commerce_marketplace_year_authority_v1.sql';

test('Shopee pode usar o ano visível do título para representar arte já atualizada', () => {
  const sql = read(migration);
  assert.equal(sql.includes("case when upper(m.code)='SHOPEE' then coalesce(s.title,l2.title) else null end"), true);
  assert.equal(sql.includes("case when upper(src_marketplace.code)='SHOPEE' then coalesce(src_snapshot.title,src_listing.title) else null end"), true);
});

test('Mercado Livre e demais fontes não deixam título sobrescrever o ano do SKU', () => {
  const sql = read(migration);
  assert.equal(sql.includes("else null end"), true);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.includes('lp2.platform_sku'), true);
  assert.equal(sql.includes('src_lp.platform_sku'), true);
});

test('miniaturas seguem a mesma autoridade por marketplace', () => {
  const sql = read(migration);
  const matches = sql.match(/case when upper\(m\.code\)='SHOPEE' then coalesce\(s\.title,l\.title\) else null end/g) || [];
  assert.equal(matches.length >= 2, true);
});
