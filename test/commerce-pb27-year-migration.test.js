import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('PB27 migration requires existing exact SKU and identical product identity',()=>{
  const sql=read('supabase/migrations/20261014142000_commerce_pb27_manual_tracking.sql');
  assert.match(sql,/upper\(btrim\(k\.sku\)\)='PB27'\|\|substr\(upper\(btrim\(s\.sku\)\),5\)/);
  assert.match(sql,/s\.matched_product_id is distinct from c\.product_id/);
  assert.match(sql,/when c\.matches<>1 then 'AMBIGUOUS'/);
  assert.match(sql,/v_batch_status<>'COMMITTED'/);
  assert.match(sql,/status='PENDING_PLATFORM'/);
  assert.match(sql,/CONFIRMED_MANUALLY/);
});
test('Catalog review distinguishes internal target from manual marketplace updates',()=>{
  const view=read('src/commerce-import-center.jsx');
  assert.match(view,/NISTI 2027:/);
  assert.match(view,/Aguardando alteração manual na plataforma/);
  assert.match(view,/Confirmei na plataforma/);
  assert.match(view,/onYearDecision\(row\.id,'REGISTER_PENDING'\)/);
  assert.match(view,/onYearDecision\(row\.id,'CONFIRM_PLATFORM'\)/);
});
