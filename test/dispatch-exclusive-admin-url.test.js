import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import edgeRouter from '../src/edge-router.js';

const origin='https://nisti-identificacao.lksntz1411.workers.dev';
const token='b'.repeat(64);
const env={
  APP_ENV:'test',
  ADMIN_PASSWORD:'test-admin-password',
  DISPATCH_SENDER_TOKEN_SHA256:createHash('sha256').update(token).digest('hex'),
  ASSETS:{fetch:async()=>new Response('<!doctype html><main id="root"></main>',{headers:{'content-type':'text/html'}})}
};
function query(path,init={}){return edgeRouter.fetch(new Request(origin+path,init),env,{})}

test('passwordless dispatch shell has no admin redirect and no privileged data',async()=>{
  const resp=await query('/painel-expedicao');
  assert.equal(resp.status,200);
  assert.match(resp.headers.get('cache-control'),/no-store/);
  assert.equal(resp.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.match(await resp.text(),/id="root"/);
  const anonymous=await query('/api/expedition-panel');
  assert.equal(anonymous.status,401);
  const denied=await query('/api/expedition-panel/options');
  assert.equal(denied.status,401);
});

test('private sender token grants persistent HttpOnly dispatch-only session',async()=>{
  const activate=await query('/api/expedition-panel/activate',{
    method:'POST',headers:{origin,'content-type':'application/json'},
    body:JSON.stringify({token})
  });
  assert.equal(activate.status,200);
  const cookie=activate.headers.get('set-cookie')||'';
  assert.match(cookie,/__Host-nisti_dispatch_sender=/);
  assert.match(cookie,/HttpOnly; Secure; SameSite=Strict/);
  assert.match(cookie,/Max-Age=2592000/);
  const session=await query('/api/expedition-panel/session',{headers:{cookie:cookie.split(';')[0]}});
  assert.deepEqual(await session.json(),{authorized:true});

  for(const [path,method] of [
    ['/api/expedition-panel/monitor-key','POST'],
    ['/api/expedition-panel/options','POST'],
    ['/api/expedition-panel/bad-action','POST']
  ]){
    const response=await query(path,{
      method,headers:{cookie:cookie.split(';')[0],origin},
      body:'{}'
    });
    assert.equal(response.status,403,path);
  }
  const admin=await query('/api/admin/dispatch');
  assert.equal(admin.status,401,'senha administrativa continua protegida');
  const logout=await query('/api/expedition-panel/logout',{
    method:'POST',headers:{origin,cookie:cookie.split(';')[0]}
  });
  assert.equal(logout.status,200);
  assert.match(logout.headers.get('set-cookie')||'',/Max-Age=0/);
});

test('invalid and revoked links do not activate or reuse access',async()=>{
  for(const input of [null,'12345','f'.repeat(64)]){
    const r=await query('/api/expedition-panel/activate',{
      method:'POST',headers:{origin,'content-type':'application/json'},
      body:JSON.stringify({token:input})
    });
    assert.equal(r.status,401);
    assert.equal(r.headers.get('set-cookie'),null);
  }
  const revoked=await edgeRouter.fetch(
    new Request(origin+'/api/expedition-panel/session',{headers:{cookie:'__Host-nisti_dispatch_sender='+token}}),
    {...env,DISPATCH_SENDER_TOKEN_SHA256:'c'.repeat(64)},{}
  );
  assert.deepEqual(await revoked.json(),{authorized:false});
});

test('authorization stays scoped to the sender URL and never runs on mural host',async()=>{
  const r=await edgeRouter.fetch(new Request('https://mural.sistemanistiid.online/painel-expedicao'),env,{});
  assert.equal(r.status,404);
  const a=await query('/api/expedition-panel/batch',{method:'POST',headers:{origin},body:'{}'});
  assert.equal(a.status,401);
  const denied=await query('/api/expedition-panel/activate',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:JSON.stringify({token})});
  assert.equal(denied.status,403);
});

test('standalone sender is free of monitor/ADM links and settings',()=>{
  const ui=fs.readFileSync(new URL('../src/expedition-dispatch-standalone.jsx',import.meta.url),'utf8');
  const view=fs.readFileSync(new URL('../src/admin/NotificationDispatchView.jsx',import.meta.url),'utf8');
  assert.match(ui,/NotificationDispatchView senderMode/);
  assert.match(ui,/window\.location\.hash/);
  assert.match(ui,/history\.replaceState/);
  assert.doesNotMatch(ui,/href="\/admin"|href="\/monitor-notificacoes"/);
  assert.match(view,/\.\.\.\(!senderMode\?/);
  assert.match(view,/!senderMode&&tab==='settings'/);
  assert.match(view,/\/api\/expedition-panel\/batch/);
  assert.match(view,/\/api\/admin\/dispatch\/batch/);
});


test('private URL authorizes a fresh browser with a redirect and an HttpOnly cookie',async()=>{
  const response=await query('/painel-expedicao?acesso='+token+'&utm_source=chatgpt.com');
  assert.equal(response.status,303);
  assert.equal(response.headers.get('location'),'/painel-expedicao');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.match(response.headers.get('set-cookie')||'',/HttpOnly; Secure; SameSite=Strict/);
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const status=await query('/api/expedition-panel/session',{headers:{cookie}});
  assert.equal((await status.json()).authorized,true);
});

test('incomplete sender link cannot grant access',async()=>{
  const response=await query('/painel-expedicao?acesso=invalid');
  assert.equal(response.status,403);
  assert.equal(response.headers.get('set-cookie'),null);
  const plain=await query('/painel-expedicao?utm_source=chatgpt.com');
  assert.equal(plain.status,200);
  assert.equal(plain.headers.get('set-cookie'),null);
});
