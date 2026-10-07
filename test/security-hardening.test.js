import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import edgeRouter from '../src/edge-router.js';
import { safePushEndpoint } from '../src/web-push.js';
import { safeCanvaDownloadUrl } from '../src/canva-product-cutout.js';

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
  const form=new FormData();
  form.append('password','a-strong-test-password');
  const response=await edgeRouter.fetch(
    new Request('https://nisti.example/admin-login',{method:'POST',body:form}),
    {
      ADMIN_PASSWORD:'a-strong-test-password',
      ADMIN_SESSION_SECRET:'separate-signing-secret-for-tests'
    },
    {}
  );
  assert.equal(response.status,302);
  const cookie=response.headers.get('set-cookie')||'';
  assert.match(cookie,/nisti_admin_session=/);
  assert.match(cookie,/HttpOnly/i);
  assert.match(cookie,/Secure/i);
  assert.match(cookie,/SameSite=Strict/i);
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
    assert.match(workflow,/npm audit --audit-level=critical/);
    assert.match(workflow,/persist-credentials: false/);
  }
});
