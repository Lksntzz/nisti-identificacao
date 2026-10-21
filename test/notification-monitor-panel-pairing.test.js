import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleNotificationDispatchRequest} from '../src/notification-dispatch-router.js';

const source=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');

test('dedicated monitor loads directly without key, cookie, PIN or approval',()=>{
  const monitor=source('../src/notification-monitor.jsx');
  const edge=source('../src/edge-router.js');
  assert.match(monitor,/post\('\/api\/dispatch\/view'\)/);
  assert.match(monitor,/Aguardando solicitações/);
  assert.doesNotMatch(monitor,/Aguardando autorização|nid-monitor-key|pairCode|pairedRef|startupPendingRef/);
  assert.doesNotMatch(monitor,/api\/dispatch\/(?:activate|next|pair)/);
  assert.match(edge,/pathname==='\/monitor-notificacoes'/);
  assert.doesNotMatch(edge,/activateDispatchMonitorLink/);
  assert.match(edge,/url\.searchParams\.has\('acesso'\)/);
});

test('admin exposes only the stable public monitor URL, not pairing controls',()=>{
  const admin=source('../src/admin/NotificationDispatchView.jsx');
  assert.match(admin,/Acesso direto ao monitor/);
  assert.match(admin,/id="nid-monitor-public-url"/);
  assert.doesNotMatch(admin,/approvePair|pairing|pendingMonitors|monitor-key|permanentLink/);
  const edge=source('../src/edge-router.js');
  assert.match(edge,/isProtectedApi\(pathname\)/);
  const router=source('../src/notification-dispatch-router.js');
  assert.match(router,/nisti_dispatch_public_next_v8/);
  assert.doesNotMatch(router,/nisti_dispatch_pair_monitor_v1|nisti_dispatch_approve_pair_v5/);
});

test('public feed retains server-owned 15-second FIFO and service-role-only database access',()=>{
  const sql=source('../supabase/migrations/20261021233000_nisti_dispatch_public_monitor_v6.sql');
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON TABLE public\.nisti_dispatch_public_monitor FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.nisti_dispatch_public_next_v6\(\) TO service_role/);
  assert.match(sql,/pg_advisory_xact_lock\(2026,1020\)/);
  assert.match(sql,/interval '15 seconds'/);
  assert.match(sql,/ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED/);
  assert.match(sql,/last_seen_at/);
});

test('legacy monitor activation routes remain disabled and admin sending remains validated',async()=>{
  for(const path of ['/api/dispatch/next','/api/dispatch/activate',
    '/api/dispatch/pair/request','/api/admin/dispatch/monitor-key']){
    const response=await handleNotificationDispatchRequest(
      new Request('https://example.com'+path,{method:'POST'}),{}
    );
    assert.equal(response.status,405,path);
  }
  const invalid=await handleNotificationDispatchRequest(
    new Request('https://example.com/api/admin/dispatch',{method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({platform:'INVALID',action:'RETIRAR_CAPA',request_key:crypto.randomUUID()})}),{}
  );
  assert.equal(invalid.status,400);
});
