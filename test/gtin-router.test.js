import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../src/gtin-router.js';

function envWithRow(row) {
  return { SUPABASE_READS_ENABLED: '0', DB: { prepare(sql) {
    assert.match(sql, /FROM product_gtins g/);
    return { bind(gtin, platform) {
      assert.equal(gtin, '7898764982617');
      assert.equal(platform, 'SHOPEE');
      return { first: async () => row };
    } };
  } } };
}

test('resolves a valid GTIN only within the selected platform', async () => {
  const response = await router.fetch(new Request('https://nisti.test/api/gtin/resolve?gtin=7898764982617&platform=shopee'), envWithRow({
    id: 1, sku: 'VACMNO_LIN1_BBB', nome: 'Caderneta', capa_code: 'LIN1', image_key: 'products/1.png',
    platform: 'SHOPEE', link: 'https://example.test/item', gtin: '7898764982617', gtin_type: 'GTIN-13'
  }), {});
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.product.id, 1);
  assert.equal(body.product.identified_by, 'gtin-gs1-v1');
  assert.equal(body.product.wireo, 'Branco');
});

test('rejects invalid checksum before touching D1', async () => {
  const response = await router.fetch(new Request('https://nisti.test/api/gtin/resolve?gtin=7898764982618&platform=SHOPEE'), { DB: { prepare() { throw new Error('D1 must not be touched'); } } }, {});
  assert.equal(response.status, 400);
});

test('returns 404 when GTIN is outside the selected platform', async () => {
  const response = await router.fetch(new Request('https://nisti.test/api/gtin/resolve?gtin=7898764982617&platform=SHOPEE'), envWithRow(null), {});
  assert.equal(response.status, 404);
});
