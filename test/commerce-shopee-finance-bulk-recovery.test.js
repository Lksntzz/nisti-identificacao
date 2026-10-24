import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const client=fs.readFileSync('src/commerce-import-client.js','utf8');
const db=fs.readFileSync('supabase/migrations/20261017001000_commerce_shopee_finance_recovery_v1.sql','utf8');

test('server still verifies SHA and current snapshot without editing sales or Scanner',()=>{
  const section=client.slice(client.indexOf('export async function reprocessShopeeSalesFinance'));
  assert.match(section,/sales\/finance\/source/);
  assert.match(section,/sales\/finance\/activate/);
  assert.doesNotMatch(section,/sales\/imports\/\$\{batchId\}\/commit/);
  assert.match(db,/p_source_sha256/);
  assert.match(db,/v_actual_units is distinct from v_units/);
  assert.match(db,/WAITING_PARTS/);
  assert.doesNotMatch(db,/update public\.commerce_sales_rows|delete from public\.commerce_sales_rows/);
  assert.doesNotMatch(db,/update public\.products|delete from public\.products/);
});
