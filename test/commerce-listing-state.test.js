import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('listing state RPC validates independent status dimensions', () => {
  const sql = read('supabase/migrations/202609221345_commerce_listing_state_rpc_v1.sql');
  assert.equal(sql.includes("('UNKNOWN', 'ACTIVE', 'PAUSED', 'INACTIVE', 'REMOVED')"), true);
  assert.equal(sql.includes("('UNKNOWN', 'SELLING', 'NO_SALES')"), true);
  assert.equal(sql.includes("('UNKNOWN', 'ACTIVE', 'ABSENT', 'DISABLED')"), true);
  assert.equal(sql.includes('last_checked_at = now()'), true);
  assert.equal(sql.includes('manual_state_checked_by'), true);
});

test('listing state RPC is service-role only', () => {
  const sql = read('supabase/migrations/202609221345_commerce_listing_state_rpc_v1.sql');
  assert.equal(sql.includes('from public, anon, authenticated'), true);
  assert.equal(sql.includes('to service_role'), true);
});

test('manual listing state route is protected and routed before generic commerce handler', () => {
  const edge = read('src/edge-router.js');
  const guard = edge.indexOf('if (isProtectedApi(pathname)');
  const stateHandler = edge.indexOf('handleCommerceListingStateRequest(request, env)');
  const genericHandler = edge.indexOf('handleCommerceAdminRequest(request, env)');
  assert.ok(guard >= 0);
  assert.ok(stateHandler > guard);
  assert.ok(genericHandler > stateHandler);
});

test('listing UI uses RPC contract IDs and exposes manual verification', () => {
  const view = read('src/commerce-listings-view.jsx');
  assert.equal(view.includes('listing.listing_id'), true);
  assert.equal(view.includes('listing.id'), false);
  assert.equal(view.includes('Salvar verificação'), true);
  assert.equal(view.includes('/state'), true);
  assert.equal(view.includes('sales_status'), true);
  assert.equal(view.includes('video_status'), true);
  assert.equal(view.includes('last_checked_at'), true);
});

test('product UI uses product_id and marketplace_codes returned by RPC', () => {
  const view = read('src/commerce-products-view.jsx');
  assert.equal(view.includes('product.product_id'), true);
  assert.equal(view.includes('product.marketplace_codes'), true);
  assert.equal(view.includes('product.marketplaces'), false);
});
