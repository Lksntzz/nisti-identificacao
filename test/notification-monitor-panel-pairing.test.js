import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleNotificationDispatchRequest,activateDispatchMonitorLink} from '../src/notification-dispatch-router.js';

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


test('kiosk uses a private revocable URL to activate its monitor session automatically',async()=>{
  const monitor=source('../src/notification-monitor.jsx');
  const admin=source('../src/admin/NotificationDispatchView.jsx');
  assert.match(monitor, /#acesso=\(\[0-9a-f\]\{64\}\)/i);
  assert.match(monitor, /window\.history\.replaceState/);
  assert.match(monitor, /api\/dispatch\/activate/);
  assert.match(monitor, /startupPendingRef\.current\|\|pollingRef\.current/);
  assert.match(admin, /Gerar link privado permanente/);
  assert.match(admin, /api\/admin\/dispatch\/monitor-key/);
  assert.match(admin, /navigator\.clipboard\.writeText\(permanentLink\)/);
  const response=await handleNotificationDispatchRequest(new Request('https://example.com/api/dispatch/activate',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:'invalid'})
  }),{});
  assert.equal(response.status,401);
});

test('kiosk link validation remains server-side and malformed links receive a visible error page',async()=>{
  assert.equal(await activateDispatchMonitorLink(new Request('https://example.com/monitor-notificacoes'),{}),null);
  for(const url of ['https://example.com/monitor-notificacoes?acesso=invalid',
    'https://example.com/monitor-notificacoes?acesso=invalid&acesso=other']){
    const response=await activateDispatchMonitorLink(new Request(url),{});
    assert.equal(response.status,400);
    assert.match(await response.text(),/link configurado no Quiosque/);
    assert.equal(response.headers.get('cache-control'),'no-store, private');
    assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  }
  const edge=source('../src/edge-router.js');
  assert.match(edge,/activateDispatchMonitorLink\(request,env\)/);
  const admin=source('../src/admin/NotificationDispatchView.jsx');
  assert.match(admin,/url\.searchParams\.set\('acesso',data\.key\)/);
  const fallback=source('../index.html');
  assert.match(fallback,/Carregando NISTI/);
  const entry=source('../src/entry.jsx');
  assert.match(entry,/MonitorErrorBoundary/);
});
