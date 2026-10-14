import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommerceImportRow } from '../src/commerce-import-normalizer.js';

function mlRow({ sku = 'AGMT26_CACTUS_PBX', variation = '881234567' } = {}) {
  const row = Array(30).fill(null);
  row[1] = 'MLB2897237300';
  row[3] = variation;
  row[4] = sku;
  row[5] = 'Agenda Cactus';
  row[6] = 'Capa 01';
  return row;
}

test('anúncio desativado do Mercado Livre não é descartado', () => {
  const parsed = normalizeCommerceImportRow({
    marketplace: 'MERCADO_LIVRE', sheetName: 'Anúncios', rowNumber: 7,
    listingStatus: 'INACTIVE', listingTitle: 'Agenda Cactus', row: mlRow()
  });
  assert.ok(parsed);
  assert.equal(parsed.normalized.source_listing_status, 'INACTIVE');
  assert.equal(parsed.normalized.status_only, false);
  assert.equal(parsed.normalized.sku_primary, 'AGMT26_CACTUS_PBX');
  assert.equal(parsed.normalized.source_variation_id, '881234567');
  assert.equal(parsed.normalized.external_listing_id, 'MLB2897237300');
});

test('linha pai sem SKU preserva apenas o estado do anúncio', () => {
  const parsed = normalizeCommerceImportRow({
    marketplace: 'MERCADO_LIVRE', sheetName: 'Anúncios', rowNumber: 7,
    listingStatus: 'INACTIVE', row: mlRow({ sku: null, variation: null })
  });
  assert.ok(parsed);
  assert.equal(parsed.status, 'REVIEW');
  assert.equal(parsed.normalized.status_only, true);
  assert.equal(parsed.normalized.sku_primary, null);
  assert.equal(parsed.normalized.source_listing_status, 'INACTIVE');
  assert.deepEqual(parsed.issues, ['listing_status_only']);
});

test('linha pai sem SKU e sem status confirmado não cria produto nem anúncio', () => {
  const parsed = normalizeCommerceImportRow({
    marketplace: 'MERCADO_LIVRE', sheetName: 'Anúncios', rowNumber: 7,
    listingStatus: 'UNKNOWN', row: mlRow({ sku: null, variation: null })
  });
  assert.equal(parsed, null);
});

test('anúncio pausado retém identidade e acessórios informados', () => {
  const parsed = normalizeCommerceImportRow({
    marketplace: 'MERCADO_LIVRE', sheetName: 'Anúncios', rowNumber: 8,
    listingStatus: 'PAUSED', row: mlRow({ sku: 'PB26_CACTUS_PBX', variation: '88221144' })
  });
  assert.ok(parsed);
  assert.equal(parsed.normalized.source_listing_status, 'PAUSED');
  assert.equal(parsed.normalized.sku_primary, 'PB26_CACTUS_PBX');
  assert.equal(parsed.normalized.source_variation_id, '88221144');
});
