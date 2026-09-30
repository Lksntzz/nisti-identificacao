import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source=fs.readFileSync(new URL('../src/public-main.jsx',import.meta.url),'utf8');
const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('Mural remains fully disabled for operators and private QA',()=>{
  assert.ok(source.includes("api('/api/mural/access')"));
  assert.ok(source.includes("onOpenMural={muralAccess ? () => setPublicView('mural') : undefined}"));
  assert.match(router,/const MURAL_PUBLIC_RELEASED = false/);
  assert.match(router,/const MURAL_PRIVATE_QA_ENABLED = false/);
  assert.match(router,/const qaAllowed = Boolean\(MURAL_PRIVATE_QA_ENABLED && qaAuthorized\)/);
  assert.match(router,/path === '\/api\/mural\/access'/);
  assert.match(router,/!MURAL_PUBLIC_RELEASED && !qaAllowed/);
  assert.ok(admin.includes('<strong>Mural desativado</strong>'));
  assert.equal(admin.includes('Abrir Mural QA'),false);
  assert.equal(admin.includes("window.location.assign('/?mural=qa')"),false);
});
