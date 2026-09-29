import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const nav=fs.readFileSync(new URL('../src/admin-navigation.js',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../src/edge-router.js',import.meta.url),'utf8');

test('phase 3 exposes the documented admin mural contract',()=>{
  for(const route of [
    '/api/admin/mural/posts',
    '/api/admin/mural/products',
    '/api/admin/mural/collections'
  ]) assert.ok(router.includes(route));
  assert.match(router,/posts\\\/(\\d\+\)\\\/publish/);
  assert.match(router,/posts\\\/(\\d\+\)\\\/archive/);
  assert.match(router,/posts\\\/(\\d\+\)\\\/image/);
  assert.match(router,/collections\\\/(\\d\+\)\\\/products/);
});

test('mural admin writes inherit existing admin session protection',()=>{
  assert.match(edge,/isProtectedApi\(pathname\)/);
  assert.match(edge,/\/api\/admin\//);
  assert.match(edge,/validSession\(request, env\)/);
});

test('editor supports product collection notice preview scheduling and archive',()=>{
  assert.ok(admin.includes('MuralNistiAdminView'));
  for(const kind of ['product','collection','notice']) assert.ok(admin.includes(`value="${kind}"`));
  assert.ok(admin.includes('Preview mobile'));
  assert.ok(admin.includes('datetime-local'));
  assert.ok(admin.includes("action(row.id,'archive')"));
  assert.ok(admin.includes("action(row.id,'duplicate')"));
});

test('image upload is constrained and server generates the R2 key',()=>{
  assert.match(router,/MAX_EDITORIAL_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(router,/image\/jpeg/);
  assert.match(router,/image\/png/);
  assert.match(router,/image\/webp/);
  assert.match(router,/crypto\.randomUUID\(\)/);
  assert.match(router,/mural\/\$\{owner\}\/\$\{id\}/);
  assert.match(admin,/1600 \/ Math\.max/);
});

test('collections preserve ordered product membership and are reachable from admin nav',()=>{
  assert.match(router,/sort_order/);
  assert.match(router,/GROUP_CONCAT\(mcp\.product_id\)/);
  assert.match(router,/env\.DB\.batch\(statements\)/);
  assert.ok(nav.includes("id: 'mural-nisti'"));
});
