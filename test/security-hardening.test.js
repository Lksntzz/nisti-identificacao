import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import edgeRouter from '../src/edge-router.js';
import { safePushEndpoint } from '../src/web-push.js';
import { safeCanvaDownloadUrl } from '../src/canva-product-cutout.js';
import { safeCanvaPageUrl } from '../src/canva-image-router.js';

async function loginFormRequest(url, env, password, headers={}) {
  const page=await edgeRouter.fetch(new Request(url),env,{});
  const html=await page.text();
  const token=html.match(/name="csrf_token" value="([^"]+)"/)?.[1];
  assert.ok(token,'login page must issue CSRF field');
  const csrfCookie=page.headers.get('set-cookie')?.split(';')[0];
  assert.match(csrfCookie||'',/^__Host-nisti_login_csrf=/);
  const form=new FormData();
  form.append('password',password);
  form.append('csrf_token',token);
  return new Request(url,{method:'POST',body:form,headers:{cookie:csrfCookie,...headers}});
}

test('cross-site mutations are rejected before application routing', async () => {
  const response=await edgeRouter.fetch(new Request('https://nisti.example/api/admin/mural/posts',{
    method:'POST',
    headers:{
      origin:'https://attacker.example',
      'sec-fetch-site':'cross-site',
      'content-type':'application/json'
    },
    body:'{}'
  }),{},{});
  assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{error:'Origem da solicitação não autorizada.'});
});

test('Cloudflare rate limit blocks abusive API and login bursts', async () => {
  const limitedEnv = {
    GLOBAL_RATE_LIMITER: { limit: async ({ key }) => ({ success: key !== 'api:203.0.113.10' }) },
    LOGIN_RATE_LIMITER: { limit: async () => ({ success: false }) }
  };

  const apiResponse = await edgeRouter.fetch(new Request('https://nisti.example/api/mural/feed', {
    headers: { 'CF-Connecting-IP': '203.0.113.10' }
  }), limitedEnv, {});
  assert.equal(apiResponse.status, 429);
  assert.equal(apiResponse.headers.get('retry-after'), '60');

  const loginRequest=await loginFormRequest('https://nisti.example/admin-login',limitedEnv,'wrong',{origin:'https://nisti.example'});
  const loginResponse = await edgeRouter.fetch(loginRequest,limitedEnv,{});
  assert.equal(loginResponse.status, 429);
});

test('Canva artwork creation has an isolated rate limit', async () => {
  let globalCalls=0;
  let canvaCalls=0;
  const response=await edgeRouter.fetch(new Request('https://nisti.example/api/admin/canva/art/create',{
    method:'POST',
    headers:{origin:'https://nisti.example','CF-Connecting-IP':'203.0.113.10'},
    body:new FormData()
  }),{
    GLOBAL_RATE_LIMITER:{limit:async()=>{globalCalls+=1;return {success:false}}},
    CANVA_ART_RATE_LIMITER:{limit:async({key})=>{canvaCalls+=1;assert.equal(key,'canva-art-create:203.0.113.10');return {success:false}}}
  },{});
  assert.equal(response.status,429);
  assert.equal(globalCalls,0);
  assert.equal(canvaCalls,1);
});

test('protected admin APIs cannot be opened from DevTools without a signed admin session', async () => {
  const response=await edgeRouter.fetch(
    new Request('https://nisti.example/api/admin/mural/posts',{method:'GET'}),
    {ADMIN_PASSWORD:'a-strong-test-password'},
    {}
  );
  assert.equal(response.status,401);
});

test('admin login response carries browser security headers and strict CSP', async () => {
  const response=await edgeRouter.fetch(
    new Request('https://nisti.example/admin-login',{method:'GET'}),
    {ADMIN_PASSWORD:'a-strong-test-password'},
    {}
  );
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.match(response.headers.get('strict-transport-security')||'',/max-age=31536000/);
  const csp=response.headers.get('content-security-policy')||'';
  assert.match(csp,/frame-ancestors 'none'/);
  assert.match(csp,/object-src 'none'/);
  assert.match(csp,/script-src 'self'/);
  assert.match(csp,/connect-src 'self'/);
  assert.doesNotMatch(csp,/supabase\.co/);
});

test('admin session cookie is HttpOnly Secure Strict and can use a dedicated signing secret', async () => {
  const env={ADMIN_PASSWORD:'a-strong-test-password',ADMIN_SESSION_SECRET:'separate-signing-secret-for-tests'};
  const req=await loginFormRequest('https://nisti.example/admin-login',env,'a-strong-test-password');
  const response=await edgeRouter.fetch(req,env,{});
  assert.equal(response.status,302);
  const cookie=response.headers.get('set-cookie')||'';
  assert.match(cookie,/nisti_admin_session=/);
  assert.match(cookie,/HttpOnly/i);
  assert.match(cookie,/Secure/i);
  assert.match(cookie,/SameSite=Strict/i);
});

test('public operator route cannot load admin panels from hash shortcuts', () => {
  const entry = fs.readFileSync(new URL('../src/entry.jsx', import.meta.url), 'utf8');
  assert.match(entry, /pathname === '\/admin'/);
  assert.doesNotMatch(entry, /hash.*admin|mural-admin/);
});

test('public clients no longer call Supabase Edge Functions directly', () => {
  const publicMain=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
  const scanner=fs.readFileSync(new URL('../src/gtin-scanner-overlay.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(publicMain,/supabase\.co\/functions\/v1|operator-direct-read|directOperatorRead/);
  assert.doesNotMatch(scanner,/supabase\.co\/functions\/v1|lookupGtinDirect/);
  assert.equal(fs.existsSync(new URL('../src/operator-direct-read.js',import.meta.url)),false);
  assert.equal(fs.existsSync(new URL('../src/gtin-supabase-lookup.js',import.meta.url)),false);
});

test('legacy direct Supabase Edge Functions are fail-closed', () => {
  for(const path of [
    '../supabase/functions/operator-read/index.ts',
    '../supabase/functions/gtin-lookup/index.ts'
  ]){
    const source=fs.readFileSync(new URL(path,import.meta.url),'utf8');
    assert.match(source,/status:410/);
    assert.match(source,/direct_edge_access_disabled/);
    assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY/);
  }
});

test('push endpoints reject localhost private networks credentials and non-HTTPS destinations', () => {
  for(const value of [
    'http://push.example/subscription',
    'https://localhost/push',
    'https://127.0.0.1/push',
    'https://10.0.0.2/push',
    'https://169.254.169.254/latest/meta-data',
    'https://192.168.1.10/push',
    'https://172.20.0.1/push',
    'https://user:pass@push.example/push'
  ]) assert.equal(safePushEndpoint(value),null,value);

  assert.equal(
    safePushEndpoint('https://web.push.apple.com/Q123'),
    'https://web.push.apple.com/Q123'
  );
  assert.equal(
    safePushEndpoint('https://wns2-southcentralus.notify.windows.com/w/?token=Q123'),
    'https://wns2-southcentralus.notify.windows.com/w/?token=Q123'
  );
  assert.equal(safePushEndpoint('https://notify.windows.com.evil.test/push'),null);
});

test('Canva server-side downloads accept only official HTTPS export URLs', () => {
  assert.equal(
    safeCanvaDownloadUrl('https://export-download.canva.com/example.png'),
    'https://export-download.canva.com/example.png'
  );
  for(const value of [
    'http://export-download.canva.com/example.png',
    'https://attacker.example/example.png',
    'https://127.0.0.1/example.png',
    'https://user:pass@export-download.canva.com/example.png'
  ]) assert.equal(safeCanvaDownloadUrl(value),null,value);
});

test('Canva editing links are restricted to the official Canva web origin', () => {
  assert.equal(
    safeCanvaPageUrl('https://www.canva.com/design/ABC/edit'),
    'https://www.canva.com/design/ABC/edit'
  );
  assert.equal(safeCanvaPageUrl('https://canva.com/design/ABC/view'),'https://canva.com/design/ABC/view');
  for(const value of [
    'http://www.canva.com/design/ABC/edit',
    'https://evil.canva.com/design/ABC/edit',
    'https://attacker.example/design/ABC/edit',
    'https://user:pass@www.canva.com/design/ABC/edit'
  ]) assert.equal(safeCanvaPageUrl(value),null,value);
});

test('public health endpoint does not disclose database topology', async () => {
  const response=await edgeRouter.fetch(new Request('https://nisti.example/api/health'),{}, {});
  assert.equal(response.status,200);
  const payload=await response.json();
  assert.deepEqual(payload,{ok:true,service:'nisti-identificacao'});
  assert.equal('database' in payload,false);
});

test('original product image upload validates size MIME and file signature', () => {
  const source=fs.readFileSync(new URL('../src/core-router.js',import.meta.url),'utf8');
  assert.match(source,/MAX_ORIGINAL_PRODUCT_IMAGE_BYTES/);
  assert.match(source,/ORIGINAL_IMAGE_TYPES/);
  assert.match(source,/detectOriginalImageType/);
  assert.match(source,/Conteúdo da imagem não corresponde ao formato informado/);
});

test('service worker cannot navigate a notification to an external origin', () => {
  const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  assert.match(sw,/safeNotificationTarget/);
  assert.match(sw,/target\.origin !== self\.location\.origin/);
});

test('all GitHub Actions are pinned to immutable commit SHAs', () => {
  const dir=new URL('../.github/workflows/',import.meta.url);
  for(const name of fs.readdirSync(dir).filter(name=>/\.ya?ml$/.test(name))){
    const workflow=fs.readFileSync(new URL(name,dir),'utf8');
    for(const match of workflow.matchAll(/uses:\s+([^\s#]+)/g)){
      const use=match[1];
      if(!use.startsWith('actions/')) continue;
      assert.match(use,/@[0-9a-f]{40}$/i,`${name}: ${use}`);
    }
  }
});

test('production gates audit runtime dependencies and critical findings', () => {
  for(const path of [
    '../.github/workflows/production-gate.yml',
    '../.github/workflows/deploy-production.yml'
  ]){
    const workflow=fs.readFileSync(new URL(path,import.meta.url),'utf8');
    assert.match(workflow,/npm ci --no-audit --no-fund/);
    assert.match(workflow,/npm audit --omit=dev --audit-level=high/);
    assert.match(workflow,/npm audit --audit-level=high/);
    assert.match(workflow,/persist-credentials: false/);
  }
});

test('admin login succeeds with its form token despite unusual fetch metadata', async () => {
  const env={ADMIN_PASSWORD:'secret-password'};
  const req=await loginFormRequest('https://admin.sistemanistiid.online/admin-login',env,'not-the-password',{
    origin:'https://sistemanistiid.online','sec-fetch-site':'same-site'
  });
  const result=await edgeRouter.fetch(req,env,{});
  assert.equal(result.status,401);
  assert.match(await result.text(),/Senha incorreta/);
});

test('forged requests without matching CSRF cookie cannot log into admin', async () => {
  const result=await edgeRouter.fetch(new Request('https://admin.sistemanistiid.online/admin-login',{
    method:'POST',body:'password=secret-password',headers:{origin:'https://attacker.example','sec-fetch-site':'cross-site'}
  }),{ADMIN_PASSWORD:'secret-password'},{});
  assert.equal(result.status,403);
  assert.ok((result.headers.get('content-type')||'').includes('text/html'));
  assert.match(await result.text(),/Sessão de login expirada/);
});

test('cross-origin API requests remain forbidden even from NISTI sibling domain', async () => {
  const result=await edgeRouter.fetch(new Request('https://admin.sistemanistiid.online/api/admin/mural/posts',{
    method:'POST',
    headers:{origin:'https://sistemanistiid.online','sec-fetch-site':'same-site'},
    body:'{}'
  }),{ADMIN_PASSWORD:'secret-password'},{});
  assert.equal(result.status,403);
  assert.deepEqual(await result.json(),{error:'Origem da solicitação não autorizada.'});
});

test('admin hostname root redirects into the protected admin route', async () => {
  for (const pathname of ['/', '/index.html']) {
    const result=await edgeRouter.fetch(
      new Request('https://admin.sistemanistiid.online'+pathname),
      {ADMIN_PASSWORD:'test-password'},{}
    );
    assert.equal(result.status,302);
    assert.equal(result.headers.get('location'),'https://admin.sistemanistiid.online/admin');
  }
  const protectedResult=await edgeRouter.fetch(
    new Request('https://admin.sistemanistiid.online/admin'),
    {ADMIN_PASSWORD:'test-password'},{}
  );
  assert.equal(protectedResult.status,302);
  assert.equal(protectedResult.headers.get('location'),'https://admin.sistemanistiid.online/admin-login');
});

test('operator and unrelated hosts do not redirect scanner homepage to admin', async () => {
  const stubAssets={fetch:async()=>new Response('<html>scanner</html>',{headers:{'content-type':'text/html'}})};
  const response=await edgeRouter.fetch(
    new Request('https://sistemanistiid.online/'),{ASSETS:stubAssets},{}
  );
  assert.notEqual(response.status,302);
});

test('login accepts a valid CSRF token with missing Origin and cross-site metadata',async()=>{
  const env={ADMIN_PASSWORD:'the-real-password'};
  const req=await loginFormRequest('https://admin.sistemanistiid.online/admin-login',env,'incorrect',{'sec-fetch-site':'cross-site'});
  const response=await edgeRouter.fetch(req,env,{});
  assert.equal(response.status,401);
});

test('tampered CSRF token never creates an admin session',async()=>{
  const env={ADMIN_PASSWORD:'the-real-password'};
  const req=await loginFormRequest('https://admin.sistemanistiid.online/admin-login',env,'the-real-password');
  const form=await req.formData();
  form.set('csrf_token','invalid');
  const response=await edgeRouter.fetch(new Request(req.url,{method:'POST',body:form,headers:{cookie:req.headers.get('cookie')}}),env,{});
  assert.equal(response.status,403);
});

test('GET logout nunca encerra uma sessão HttpOnly; apenas POST do próprio site pode fazê-lo',async()=>{
  const env={ADMIN_PASSWORD:'strong-test-secret',LOGIN_RATE_LIMITER:{limit:async()=>({success:true})}};
  const login=await loginFormRequest('https://admin.sistemanistiid.online/admin-login',env,env.ADMIN_PASSWORD,{
    origin:'https://admin.sistemanistiid.online','sec-fetch-site':'same-origin'
  });
  const signed=await edgeRouter.fetch(login,env,{});
  assert.equal(signed.status,302);
  const sessionCookie=signed.headers.get('set-cookie')?.split(';')[0];
  assert.match(sessionCookie||'',/^nisti_admin_session=/);

  const get=await edgeRouter.fetch(new Request('https://admin.sistemanistiid.online/admin-logout',{
    headers:{cookie:sessionCookie,'sec-fetch-site':'cross-site'}
  }),env,{});
  assert.equal(get.status,405);
  assert.equal(get.headers.get('allow'),'POST');
  assert.equal(get.headers.get('set-cookie'),null);

  const attacker=await edgeRouter.fetch(new Request('https://admin.sistemanistiid.online/admin-logout',{
    method:'POST',headers:{cookie:sessionCookie,origin:'https://attacker.invalid','sec-fetch-site':'cross-site'}
  }),env,{});
  assert.equal(attacker.status,403);
  assert.equal(attacker.headers.get('set-cookie'),null);

  const logout=await edgeRouter.fetch(new Request('https://admin.sistemanistiid.online/admin-logout',{
    method:'POST',headers:{cookie:sessionCookie,origin:'https://admin.sistemanistiid.online','sec-fetch-site':'same-origin'}
  }),env,{});
  assert.equal(logout.status,303);
  assert.match(logout.headers.get('set-cookie')||'',/nisti_admin_session=;/);
  assert.match(logout.headers.get('set-cookie')||'',/Max-Age=0/);
});

test('botões Sair usam POST e não tentam apagar cookie HttpOnly no cliente',()=>{
  for(const file of ['../src/main.jsx','../src/commerce-admin-app-v2.jsx']){
    const code=fs.readFileSync(new URL(file,import.meta.url),'utf8');
    assert.doesNotMatch(code,/href="\/admin-logout"/);
    assert.doesNotMatch(code,/document\.cookie\s*=\s*'nisti_admin_session=/);
    assert.match(code,/<form method="POST" action="\/admin-logout"/);
  }
});

test('falha ou ausência do rate limiter não libera tentativa ilimitada de login em produção',async()=>{
  const env={APP_ENV:'production',ADMIN_PASSWORD:'a-strong-test-password'};
  const unbound=await loginFormRequest('https://admin.sistemanistiid.online/admin-login',env,env.ADMIN_PASSWORD,{
    origin:'https://admin.sistemanistiid.online'
  });
  const result=await edgeRouter.fetch(unbound,env,{});
  assert.equal(result.status,503);
  const errEnv={...env,LOGIN_RATE_LIMITER:{limit:async()=>{throw Error('limiter down')}}};
  const req=await loginFormRequest('https://admin.sistemanistiid.online/admin-login',errEnv,errEnv.ADMIN_PASSWORD,{
    origin:'https://admin.sistemanistiid.online'
  });
  assert.equal((await edgeRouter.fetch(req,errEnv,{})).status,503);
});
