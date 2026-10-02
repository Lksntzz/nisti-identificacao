import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const core=fs.readFileSync('src/core-router.js','utf8');
const finish=fs.readFileSync('src/product-finish-router.js','utf8');

test('Supabase-primary product create/update paths synchronize Commerce instead of returning a cutover skip',()=>{
  const upsertStart=core.indexOf('async function upsertCatalogProduct');
  const upsertEnd=core.indexOf('async function listCoverReferences',upsertStart);
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

test('health endpoint reports Supabase as primary when Supabase reads are enabled',()=>{
  const start=core.indexOf("url.pathname === '/api/health'");
  const end=core.indexOf("url.pathname === '/api/sku/parse'",start);
  const block=core.slice(start,end);
  assert.match(block,/primary:\s*supabaseReads \? 'supabase' : 'd1'/);
  assert.match(block,/write_authority:\s*supabaseWrites \? 'supabase' : 'd1'/);
});

test('cover reference listing is Supabase-only after the D1 runtime detachment',()=>{
  const start=core.indexOf('async function listCoverReferences');
  const end=core.indexOf('async function addCoverReference',start);
  const block=core.slice(start,end);
  assert.match(block,/supabaseCoverReferences/);
  assert.doesNotMatch(block,/env\.DB/);
  assert.doesNotMatch(block,/supabasePrimaryWritesRequested/);
});
