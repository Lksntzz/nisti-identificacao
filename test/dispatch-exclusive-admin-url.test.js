import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import edgeRouter from '../src/edge-router.js';

const origin='https://nisti-identificacao.lksntz1411.workers.dev';
const env={
  ADMIN_PASSWORD:'test-secret-for-administrators',
  APP_ENV:'test',
  ASSETS:{fetch:async()=>new Response('<!doctype html><title>NISTI</title><div id="root"></div>',{
    headers:{'content-type':'text/html; charset=utf-8'}
  })}
};
async function fetchApp(path,options={}){
  return edgeRouter.fetch(new Request(origin+path,options),env,{});
}

test('separate expedition panel is server-protected, not accessible with an operator PIN',async()=>{
  const res=await fetchApp('/painel-expedicao');
  assert.equal(res.status,302);
  assert.equal(new URL(res.headers.get('location')).pathname,'/admin-login');
  assert.equal(new URL(res.headers.get('location')).searchParams.get('return_to'),'/painel-expedicao');
  assert.match(res.headers.get('x-frame-options')||'',/DENY/);
  assert.equal(res.headers.get('set-cookie'),null);
});

test('administrative login returns to the protected expedition panel without revealing the rest of ADM',async()=>{
  const page=await fetchApp('/admin-login?return_to=%2Fpainel-expedicao');
  assert.equal(page.status,200);
  const markup=await page.text();
  assert.match(markup,/name="return_to" value="\/painel-expedicao"/);
  const csrf=markup.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  const csrfCookie=page.headers.get('set-cookie')?.split(';')[0];
  assert.ok(csrf&&csrfCookie);
  const form=new FormData();
  form.set('csrf_token',csrf);
  form.set('password',env.ADMIN_PASSWORD);
  form.set('return_to','/painel-expedicao');
  const loggedIn=await fetchApp('/admin-login',{
    method:'POST',
    body:form,
    headers:{cookie:csrfCookie,origin}
  });
  assert.equal(loggedIn.status,302);
  assert.equal(loggedIn.headers.get('location'),'/painel-expedicao');
  const cookie=loggedIn.headers.get('set-cookie')?.split(';')[0];
  assert.match(cookie||'',/^nisti_admin_session=/);
  const panel=await fetchApp('/painel-expedicao',{headers:{cookie}});
  assert.equal(panel.status,200);
  assert.match(await panel.text(),/id="root"/);
  assert.match(panel.headers.get('cache-control')||'',/no-store/);
  assert.match(panel.headers.get('content-security-policy')||'',/frame-ancestors 'none'/);
});

test('login return targets are allowlisted to prevent open redirects',async()=>{
  for(const untrusted of ['https://evil.example','//evil.example','/api/admin/products','/monitor-notificacoes']){
    const login=await fetchApp('/admin-login?return_to='+encodeURIComponent(untrusted));
    assert.equal(login.status,200);
    const html=await login.text();
    assert.match(html,/name="return_to" value="\/admin"/);
    assert.doesNotMatch(html,/name="return_to" value="\/api\/admin/);
  }
});

test('expedition panel cannot load from mural-only hostname',async()=>{
  const r=await edgeRouter.fetch(new Request('https://mural.sistemanistiid.online/painel-expedicao'),env,{});
  assert.equal(r.status,404);
});

test('standalone route lazy-loads only the dispatch admin module',()=>{
  const entry=fs.readFileSync(new URL('../src/entry.jsx',import.meta.url),'utf8');
  const standalone=fs.readFileSync(new URL('../src/expedition-dispatch-standalone.jsx',import.meta.url),'utf8');
  const wrapper=fs.readFileSync(new URL('../src/expedition-dispatch-standalone.css',import.meta.url),'utf8');
  assert.match(entry,/window\.location\.pathname === '\/painel-expedicao'/);
  assert.match(entry,/import\('\.\/expedition-dispatch-standalone\.jsx'\)/);
  assert.match(standalone,/NotificationDispatchView/);
  assert.match(standalone,/\/monitor-notificacoes/);
  assert.match(standalone,/\/admin-logout/);
  assert.doesNotMatch(standalone,/\.\/main\.jsx|\.\/public-main\.jsx/);
  assert.match(wrapper,/\.nid-expedition-main/);
});
