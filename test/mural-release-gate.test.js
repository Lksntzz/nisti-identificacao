import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../src/edge-router.js',import.meta.url),'utf8');

test('operator mural remains gated while authenticated admin sessions can run private QA',()=>{
  assert.ok(source.includes("import MuralNisti from './mural-nisti.jsx'"));
  assert.ok(source.includes("api('/api/mural/access')"));
  assert.ok(source.includes('muralAccess ? ('));
  assert.ok(source.includes('<MuralNisti onUnreadChange={setMuralUnread} />'));
  assert.ok(source.includes('mural-coming-soon'));
  assert.ok(source.includes('<h2>Em breve</h2>'));
  assert.ok(source.includes('Voltar ao Scanner'));
  assert.match(router,/const MURAL_PUBLIC_RELEASED = false/);
  assert.match(router,/path === '\/api\/mural\/access'/);
  assert.match(router,/path\.startsWith\('\/api\/mural'\) && !MURAL_PUBLIC_RELEASED && !qaAuthorized/);
  assert.match(edge,/muralQaSession = pathname\.startsWith\('\/api\/mural'\) \? await validSession/);
});
