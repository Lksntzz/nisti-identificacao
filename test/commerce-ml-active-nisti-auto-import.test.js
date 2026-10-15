import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexMercadoLivreBulkStatus } from '../src/commerce-import-normalizer.js';

function makeRow({ id, status, sku = '', variation = null, title = null }) {
  const row = Array(32).fill(null);
  row[1] = id;
  row[3] = variation;
  row[4] = sku;
  row[5] = title;
  row[27] = status; // STATUS (AB) in the export of 15/10/2026.
  row[29] = 20; // SHIPPING_WIDTH (AD): must NOT be parsed as STATUS.
  return row;
}

function officialWorkbookRows() {
  const header = Array(32).fill(null);
  header[1] = 'ITEM_ID';
  header[5] = 'TITLE';
  header[27] = 'STATUS';
  const filler = Array.from({ length: 5 }, () => Array(32).fill(null));
  return [
    header,
    ...filler,
    makeRow({ id: 'MLB1234567890', status: 'Ativo', sku: 'PLAN25_GNAT_PXP', title: 'Planner' }),
    makeRow({ id: 'MLB1234567890', status: 0, sku: 'PLAN27_GNAT_PXP', variation: '12345' }),
    makeRow({ id: 'MLB1234567891', status: 'Inativo', sku: 'PB25_ABC_BBB' }),
    makeRow({ id: 'MLB1234567892', status: 'Pausado' })
  ];
}

test('official Mercado Livre export uses STATUS header, not column AD', () => {
  const index = indexMercadoLivreBulkStatus(officialWorkbookRows());
  assert.equal(index.statuses.get('MLB1234567890'), 'ACTIVE');
  assert.equal(index.statuses.get('MLB1234567891'), 'INACTIVE');
  assert.equal(index.statuses.get('MLB1234567892'), 'PAUSED');
  assert.equal(index.titles.get('MLB1234567890'), 'Planner');
  assert.equal(index.statuses.size, 3, 'child variation is not a second listing');
});

test('official export requires STATUS and rejects conflicting parent states', () => {
  const missing = officialWorkbookRows();
  missing[0][27] = 'WRONG';
  assert.throws(() => indexMercadoLivreBulkStatus(missing), /STATUS/);
  const conflict = officialWorkbookRows();
  conflict.push(makeRow({ id: 'MLB1234567890', status: 'Inativo' }));
  assert.throws(() => indexMercadoLivreBulkStatus(conflict), /conflitante/);
});

test('current import path filters to ACTIVE and invokes server-side auto-link without new UI', () => {
  const reader = fs.readFileSync('src/commerce-xlsx-reader.js', 'utf8');
  const store = fs.readFileSync('src/commerce-supabase-store.js', 'utf8');
  const sql = fs.readFileSync('supabase/migrations/20261015190000_ml_active_nisti_auto_link_v1.sql', 'utf8');
  assert.match(reader, /listingStatusById\.get\(.*\) !== 'ACTIVE'/);
  assert.match(reader, /indexMercadoLivreBulkStatus\(data\)/);
  assert.match(store, /commerce_reconcile_import_batch_auto_v1/);
  assert.match(sql, /commerce_sync_import_listing_states_account_v1/);
  assert.match(sql, /commerce_sync_nisti_product_v1/);
  assert.match(sql, /commerce_nisti_sku_norm_v1/);
  assert.match(sql, /NISTI_FAMILY_YEAR/);
  assert.match(sql, /from public,anon,authenticated/);
  assert.match(sql, /to service_role/);
  assert.doesNotMatch(reader, /raw\?\.\[29\]/);
});
