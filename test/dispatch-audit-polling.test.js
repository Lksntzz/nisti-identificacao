import test from 'node:test';
import assert from 'node:assert/strict';
import { isSuccessfulDispatchPolling, recordAdminActivityFromResponse } from '../src/system-notifications.js';

test('successful dispatch polling is ignored by admin audit', async () => {
  for (const path of ['/api/dispatch/view', '/api/dispatch/next', '/api/dispatch/pair/status']) {
    for (const method of ['GET', 'POST']) {
      const request = new Request('https://nisti.example' + path, { method });
      const response = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      assert.equal(isSuccessfulDispatchPolling(path, 200), true);
      assert.equal(await recordAdminActivityFromResponse(request, response, {}), null);
    }
  }
});

test('dispatch errors and genuine mutations are not suppressed by polling rule', () => {
  for (const path of ['/api/dispatch/view', '/api/dispatch/next', '/api/dispatch/pair/status']) {
    assert.equal(isSuccessfulDispatchPolling(path, 400), false);
    assert.equal(isSuccessfulDispatchPolling(path, 500), false);
    assert.equal(isSuccessfulDispatchPolling(path, 204), true);
  }
  assert.equal(isSuccessfulDispatchPolling('/api/admin/dispatch/batch', 200), false);
  assert.equal(isSuccessfulDispatchPolling('/api/dispatch/pair/approve', 200), false);
  assert.equal(isSuccessfulDispatchPolling('/api/products', 200), false);
});
