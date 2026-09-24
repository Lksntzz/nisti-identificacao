import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

const migration = 'supabase/migrations/202609241500_commerce_image_year_safety_v1.sql';

test('extrai ano de SKUs anuais sem confundir códigos numéricos genéricos', () => {
  const sql = read(migration);
  assert.equal(sql.includes('commerce_sku_edition_year'), true);
  assert.equal(sql.includes("'^[A-Z&]+[^0-9A-Z]*(2[4-9]|3[0-5])'"), true);
  assert.equal(sql.includes("'20(2[4-9]|3[0-5])'"), true);
});

test('fallback entre plataformas exige compatibilidade entre ano do SKU e ano da arte fonte', () => {
  const sql = read(migration);
  assert.equal(sql.includes('commerce_image_years_compatible'), true);
  assert.equal(sql.includes('coalesce(s.title,l2.title)'), true);
  assert.equal(sql.includes('coalesce(src_snapshot.title,src_listing.title)'), true);
  assert.equal(sql.includes('target_year is null'), true);
  assert.equal(sql.includes('source_year=target_year'), true);
});

test('fallback NISTI ID também respeita o SKU específico do anúncio', () => {
  const sql = read(migration);
  assert.equal(sql.includes('commerce_image_years_compatible(lp.platform_sku,media.matched_sku,null)'), true);
});

test('imagem própria da plataforma continua com prioridade máxima', () => {
  const sql = read(migration);
  const own = sql.indexOf('l.cover_image_url,');
  const inherited = sql.indexOf("inherited.images->0->>'image_url'");
  const nisti = sql.indexOf("nisti.images->0->>'image_url'");
  assert.ok(own >= 0);
  assert.ok(inherited > own);
  assert.ok(nisti > inherited);
});
