import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleNotificationDispatchRequest} from '../src/notification-dispatch-router.js';

const source=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');

test('anonymous client cannot read pairing state without browser-bound cookie',async()=>{
  const response=await handleNotificationDispatchRequest(
    new Request('https://example.com/api/dispatch/pair/status',{method:'POST'}),{}
  );
  assert.equal(response.status,401);
});

test('admin approval rejects forged or missing request ids before touching storage',async()=>{
  for(const id of ['',123,'abc','f'.repeat(128)]){
    const response=await handleNotificationDispatchRequest(
      new Request('https://example.com/api/admin/dispatch/pair/approve',{
        method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({id})
      }),{}
    );
    assert.equal(response.status,400);
  }
});

test('monitor pairing cannot access the queue without a monitor credential',async()=>{
  const response=await handleNotificationDispatchRequest(
    new Request('https://example.com/api/dispatch/next',{
      method:'POST',headers:{cookie:'__Host-nisti_dispatch_pair='+'1'.repeat(64)}
    }),{}
  );
  assert.equal(response.status,401);
});

test('approval is server-controlled, preserves RLS and requires a pending unexpired request',()=>{
  const sql=source('../supabase/migrations/20261021232000_nisti_dispatch_panel_pairing_v5.sql');
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON TABLE public\.nisti_dispatch_pair_requests FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/WHERE id=p_id AND state='PENDING' AND expires_at>clock_timestamp\(\)/);
  assert.match(sql,/key_digest=excluded\.key_digest/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.nisti_dispatch_approve_pair_v5\(uuid\) TO service_role/);
});

test('monitor has no manual key entry, and admin has explicit approval control',()=>{
  const monitor=source('../src/notification-monitor.jsx');
  const admin=source('../src/admin/NotificationDispatchView.jsx');
  const edge=source('../src/edge-router.js');
  assert.match(monitor,/Aguardando autorização/);
  assert.match(monitor,/api\/dispatch\/pair\/status/);
  assert.doesNotMatch(monitor,/nid-monitor-key/);
  assert.match(admin,/api\/admin\/dispatch\/pair\/approve/);
  assert.match(admin,/Ativar monitor/);
  assert.match(admin,/item\.code/);
  assert.match(edge,/isProtectedApi\(pathname\)/);
});
