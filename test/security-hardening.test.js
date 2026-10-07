import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import edgeRouter from '../src/edge-router.js';
import { safePushEndpoint } from '../src/web-push.js';

test('cross-site state-changing requests are rejected before application routing', async () => {
  const request = new Request('https://nisti.example/api/admin/mural/posts', {
    method:'POST',
    headers:{
      origin:'https://attacker.example',
      'sec-fetch-site':'cross-site',
      'content-type':'application/json'
    },
    body:'{}'
  });
  const response = await edgeRouter.fetch(request, {}, {});
  assert.equal(response.status,403);
  const payload=await response.json();
  assert.equal(payload.error,'Origem da solicitação não autorizada.');
});

test('admin API stays inaccessible without a valid signed session', async () => {
  const response = await edgeRouter.fetch(
    new Request('https://nisti.example/api/admin/mural/posts',{method:'GET'}),
    {ADMIN_PASSWORD:'strong-test-password'},
    {}
  );
  assert.equal(response.status,401);
});

test('admin login responses carry browser hardening headers', async () => {
  const response = await edgeRouter.fetch(
    new Request('https://nisti.example/admin-login',{method:'GET'}),
    {ADMIN_PASSWORD:'strong-test-password'},
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
  assert.match(csp,/form-action 'self'/);
  assert.match(csp,/script-src 'self';/);
  assert.equal(csp.includes("script-src 'self' 'unsafe-inline'"),false);
});

test('browser bootstrap has no inline executable script and Vite does not trust every host', () => {
  const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
  const vite=fs.readFileSync(new URL('../vite.config.js',import.meta.url),'utf8');
  const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  assert.match(html,/src="\/desktop-mode\.js"/);
  assert.equal(/<script>/.test(html),false);
  assert.equal(vite.includes("allowedHosts: 'all'"),false);
  assert.match(sw,/safeNotificationTarget/);
  assert.match(sw,/target\.origin !== self\.location\.origin/);
});

test('session signing supports a dedicated Worker secret', () => {
  const source=fs.readFileSync(new URL('../src/edge-router.js',import.meta.url),'utf8');
  assert.match(source,/ADMIN_SESSION_SECRET/);
  assert.match(source,/dedicated \? `\$\{dedicated\}:\$\{password\}` : password/);
});

test('successful admin login issues an HttpOnly Secure Strict cookie', async () => {
  const form=new FormData();
  form.append('password','strong-test-password');
  const response = await edgeRouter.fetch(
    new Request('https://nisti.example/admin-login',{method:'POST',body:form}),
    {ADMIN_PASSWORD:'strong-test-password'},
    {}
  );
  assert.equal(response.status,302);
  const cookie=response.headers.get('set-cookie')||'';
  assert.match(cookie,/nisti_admin_session=/);
  assert.match(cookie,/HttpOnly/i);
  assert.match(cookie,/Secure/i);
  assert.match(cookie,/SameSite=Strict/i);
});

test('push endpoint validation blocks private, local and non-HTTPS destinations', () => {
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
    safePushEndpoint('https://push.example/subscription/abc'),
    'https://push.example/subscription/abc'
  );
});

test('production workflows use immutable action SHAs and dependency audit', () => {
  for(const path of [
    '../.github/workflows/production-gate.yml',
    '../.github/workflows/deploy-production.yml'
  ]){
    const workflow=fs.readFileSync(new URL(path,import.meta.url),'utf8');
    assert.match(workflow,/actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/);
    assert.match(workflow,/actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
    assert.match(workflow,/persist-credentials: false/);
    assert.match(workflow,/npm ci --no-audit --no-fund/);
    assert.match(workflow,/npm audit --omit=dev --audit-level=high/);
    assert.match(workflow,/npm audit --audit-level=critical/);
  }
});
