import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleNotificationDispatchRequest,DISPATCH_DURATION_SECONDS,DISPATCH_PLATFORMS} from '../src/notification-dispatch-router.js';

test('the dispatch board uses exactly ten seconds and canonical platforms',()=>{
  assert.equal(DISPATCH_DURATION_SECONDS,10);
  assert.deepEqual(DISPATCH_PLATFORMS,['SHOPEE','MERCADO LIVRE','AMAZON']);
  const migration=fs.readFileSync(new URL('../supabase/migrations/20261021200000_nisti_dispatch_board_v1.sql',import.meta.url),'utf8');
  assert.match(migration,/interval '10 seconds'/);
  assert.match(migration,/ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.nisti_dispatch_next_v1/);
});

test('reject invalid anonymous activation without contacting Supabase',async()=>{
  const res=await handleNotificationDispatchRequest(
    new Request('https://example.com/api/dispatch/activate',{method:'POST',body:JSON.stringify({key:'1234'})}),{}
  );
  assert.equal(res.status,401);
});
test('a monitor cannot advance the queue without a paired cookie',async()=>{
  const res=await handleNotificationDispatchRequest(
    new Request('https://example.com/api/dispatch/next',{method:'POST'}),{}
  );
  assert.equal(res.status,401);
});
test('admin cannot enqueue unsupported actions or platforms',async()=>{
  const r=await handleNotificationDispatchRequest(new Request('https://example.com/api/admin/dispatch',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({platform:'SHOPEE',action:'APAGAR_DADOS',request_key:crypto.randomUUID()})
  }),{});
  assert.equal(r.status,400);
});
test('unrecognized paths are passed through to existing router',async()=>{
  assert.equal(await handleNotificationDispatchRequest(new Request('https://example.com/api/products'),{}),null);
});
