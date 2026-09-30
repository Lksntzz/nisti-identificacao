import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../src/edge-router.js',import.meta.url),'utf8');
const mural=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');

test('operator sees only Em breve while QA requires explicit mode plus admin session',()=>{
  assert.ok(source.includes("api('/api/mural/access', {"));
  assert.ok(source.includes("const qaRequested = new URLSearchParams(window.location.search).get('mural') === 'qa'"));
  assert.ok(source.includes("headers: qaRequested ? { 'x-mural-qa': '1' } : {}"));
  assert.ok(source.includes("Boolean(data?.released || (qaRequested && data?.qa))"));
  assert.ok(source.includes('mural-coming-soon'));
  assert.ok(source.includes('<h2>Em breve</h2>'));
  assert.ok(source.includes('<MuralNisti onUnreadChange={setMuralUnread} />'));

  assert.match(router,/const MURAL_PUBLIC_RELEASED = false/);
  assert.match(router,/path === '\/api\/mural\/access'/);
  assert.match(router,/!MURAL_PUBLIC_RELEASED && !qaAuthorized/);

  assert.ok(edge.includes("const muralQaRequested = request.headers.get('x-mural-qa') === '1'"));
  assert.ok(edge.includes("pathname.startsWith('/api/mural') && muralQaRequested"));
  assert.ok(mural.includes("new URLSearchParams(window.location.search).get('mural') === 'qa'"));
  assert.ok(mural.includes("'x-mural-qa': '1'"));
});

test('admin session by itself does not authorize the Mural interface',()=>{
  assert.equal(edge.includes("pathname.startsWith('/api/mural') ? await validSession(request, env) : false"),false);
  assert.ok(edge.includes("const muralQaSession = pathname.startsWith('/api/mural') && muralQaRequested"));
});
