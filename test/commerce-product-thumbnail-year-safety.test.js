import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const migration = 'supabase/migrations/202609241515_commerce_product_thumbnail_year_safety_v1.sql';

test('miniatura do Produto Mestre usa contexto da plataforma filtrada', () => {
  const sql = read(migration);
  assert.equal(sql.includes('commerce_list_products_v3'), true);
  assert.equal(sql.includes('commerce_preview_list_products_v3'), true);
  assert.equal(sql.includes('upper(m.code)=upper(btrim(p_marketplace_code))'), true);
  assert.equal(sql.includes('target.target_sku'), true);
});

test('outra plataforma só pode fornecer miniatura com ano compatível', () => {
  const sql = read(migration);
  assert.equal(sql.includes('commerce_image_years_compatible('), true);
  assert.equal(sql.includes('coalesce(s.title,l.title)'), true);
  assert.equal(sql.includes('lp.platform_sku'), true);
});

test('imagem própria da plataforma filtrada mantém prioridade', () => {
  const sql = read(migration);
  assert.equal(sql.includes('then 0\n        else 1'), true);
  assert.equal(sql.includes("when thumb.image_url is not null then 'MARKETPLACE'"), true);
});

test('fallback NISTI ID também usa o SKU alvo da plataforma', () => {
  const sql = read(migration);
  assert.equal(sql.includes('media.matched_sku'), true);
  assert.equal(sql.includes('coalesce(target.target_sku,p.current_sku)'), true);
});
