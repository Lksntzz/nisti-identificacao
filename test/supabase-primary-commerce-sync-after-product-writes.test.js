import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('src/core-router.js','utf8');
const finish=fs.readFileSync('src/product-finish-router.js','utf8');

test('Supabase-primary product create/update paths synchronize Commerce instead of returning a cutover skip',()=>{
  const upsertStart=core.indexOf('async function upsertCatalogProduct');
  const upsertEnd=core.indexOf('export default',upsertStart);
  const upsert=core.slice(upsertStart,upsertEnd);
  assert.match(upsert,/syncNistiProductToCommerceSafe\(env, Number\(saved\.id\)\)/);
  assert.doesNotMatch(upsert,/reason:\s*'supabase_primary_cutover'/);

  const updateStart=core.indexOf("if (productSingle && (request.method === 'PUT' || request.method === 'PATCH'))");
  const updateEnd=core.indexOf('const imageUpload',updateStart);
  const update=core.slice(updateStart,updateEnd);
  assert.match(update,/syncNistiProductToCommerceSafe\(env, id\)/);
  assert.match(update,/scheduleCommerceReconcile\(ctx, env, id, commerceSync\)/);
  assert.doesNotMatch(update,/reason:\s*'supabase_primary_cutover'/);
});

test('bulk product import synchronizes Commerce in Supabase-primary mode too',()=>{
  const start=core.indexOf("url.pathname === '/api/admin/bulk-products'");
  const end=core.indexOf('const productSingle',start);
  const block=core.slice(start,end);
  assert.match(block,/syncNistiProductsToCommerce\(env, syncedIds\)/);
  assert.doesNotMatch(block,/!supabasePrimaryWritesRequested\(env\)/);
});

test('finish edits synchronize and reconcile Commerce after the authoritative write',()=>{
  assert.match(finish,/syncNistiProductToCommerceSafe\(env,id\)/);
  assert.match(finish,/reconcileNistiProductToCommerceSafe\(env,id\)/);
  const primary=finish.indexOf('nisti_finish_product_primary_v1');
  const sync=finish.indexOf('syncNistiProductToCommerceSafe(env,id)',primary);
  assert.ok(primary>=0 && sync>primary);
});

test('public health endpoint does not reveal Supabase write or read topology',()=>{
  const start=core.indexOf("url.pathname === '/api/health'");
  const end=core.indexOf("url.pathname === '/api/sku/parse'",start);
  const block=core.slice(start,end);
  assert.match(block,/ok:true/);
  assert.match(block,/service:'nisti-identificacao'/);
  assert.doesNotMatch(block,/supabaseReads|supabaseWrites|write_authority|database:/);
});
