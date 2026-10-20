import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleNotificationDispatchRequest,DISPATCH_DURATION_SECONDS,DISPATCH_PLATFORMS} from '../src/notification-dispatch-router.js';

test('the dispatch board uses 15 seconds and canonical platforms',()=>{
  assert.equal(DISPATCH_DURATION_SECONDS,15);
  assert.deepEqual(DISPATCH_PLATFORMS,['SHOPEE','MERCADO LIVRE','AMAZON']);
  const migration=fs.readFileSync(new URL('../supabase/migrations/20261021200000_nisti_dispatch_board_v1.sql',import.meta.url),'utf8');
  assert.match(migration,/interval '10 seconds'/);
  const v2=fs.readFileSync(new URL('../supabase/migrations/20261021210000_nisti_dispatch_15s_multi_messages_v2.sql',import.meta.url),'utf8');
  assert.match(v2,/interval '15 seconds'/);
  assert.match(v2,/nisti_dispatch_enqueue_batch_v2/);
  assert.match(v2,/pg_advisory_xact_lock/);
  assert.match(v2,/dispatch_idempotency_conflict/);
  assert.match(v2,/length\(v_message\) NOT BETWEEN 1 AND 120/);
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

test('rejects empty batch, duplicate platform, invalid messages before database access',async()=>{
  const base='https://example.com/api/admin/dispatch/batch';
  for(const calls of [
    [],
    [{platform:'SHOPEE',message:'',request_key:crypto.randomUUID()}],
    [{platform:'SHOPEE',message:'Olá\nMundo',request_key:crypto.randomUUID()}],
    [{platform:'SHOPEE',message:'AVISO',request_key:'invalid'}],
    [{platform:'SHOPEE',message:'A',request_key:crypto.randomUUID()},
     {platform:'SHOPEE',message:'B',request_key:crypto.randomUUID()}]
  ]){
    const response=await handleNotificationDispatchRequest(new Request(base,{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({calls})
    }),{});
    assert.equal(response.status,400);
  }
});
test('monitor shows message and uses duration-derived progress bar',()=>{
  const frontend=fs.readFileSync(new URL('../src/notification-monitor.jsx',import.meta.url),'utf8');
  assert.match(frontend,/current\.message/);
  assert.match(frontend,/seconds\/duration\*100/);
});
test('multi-platform admin has independent message controls',()=>{
  const frontend=fs.readFileSync(new URL('../src/admin/NotificationDispatchView.jsx',import.meta.url),'utf8');
  assert.match(frontend,/type="checkbox"/);
  assert.match(frontend,/nid-platform-detail/);
  assert.match(frontend,/api\/admin\/dispatch\/batch/);
});
