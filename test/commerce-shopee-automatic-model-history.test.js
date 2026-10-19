import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const model=fs.readFileSync('supabase/migrations/20261019145000_commerce_shopee_model_history_versioned_only.sql','utf8');
const raw=fs.readFileSync('supabase/migrations/20261019144500_commerce_shopee_unlinked_history_v1.sql','utf8');
const manager=fs.readFileSync('src/commerce-ad-manager.jsx','utf8');
const panel=fs.readFileSync('src/commerce-shopee-unlinked-sales.jsx','utf8');
const store=fs.readFileSync('src/commerce-supabase-store.js','utf8');

test('junta histórico antigo e atual por modelo sem sobrescrever pedidos ou SKUs',()=>{
  assert.match(model,/commerce_shopee_model_sales_history_v1/);
  assert.match(model,/commerce_sales_rows r/);
  assert.match(model,/commerce_sales_snapshots sn on sn.id=r.snapshot_id and sn.is_current/);
  assert.match(model,/model_key/);
  assert.match(model,/has_versioned_model/);
  assert.match(model,/MODEL_HISTORY_NOT_AD_ID/);
  assert.match(model,/security invoker/);
  assert.match(model,/from public,anon,authenticated/);
  assert.match(model,/to service_role/);
  assert.doesNotMatch(model,/\b(insert into|update|delete from)\s+public\.commerce_sales_rows/i);
});
test('não troca os aliases confirmados de outras famílias por histórico exato',()=>{
  assert.match(store,/commerce_listing_manager_months_v1/);
  assert.match(store,/commerce_shopee_model_sales_history_v1/);
  assert.match(manager,/modelHistory\?\.has_versioned_model/);
  assert.match(manager,/historicalMonths\.slice\(-6\)/);
  assert.match(panel,/Não é uma confirmação do ID do anúncio/);
});
test('SKU sem anúncio segue visível com unidades, receita e meses sem associação manual',()=>{
  assert.match(raw,/historic_rows as/);
  assert.match(raw,/historic_by_model as/);
  assert.match(raw,/history_months/);
  assert.match(raw,/source_groups s/);
  assert.match(raw,/commerce_shopee_sku_owner_reviewed_v1 mapped/);
  assert.match(panel,/nim-model-sale-card/);
  assert.match(panel,/history\.map\(m=>/);
  assert.match(panel,/number\(item\.units\)/);
  assert.match(panel,/money\(item\.revenue\)/);
  assert.doesNotMatch(panel,/reconciliation\/approve/);
});
