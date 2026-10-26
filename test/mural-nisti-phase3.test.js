import { muralAdminSource } from './helpers/mural-admin-source.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const imageRoutes=fs.readFileSync(new URL('../src/mural-image-routes.js',import.meta.url),'utf8');
const collectionRoutes=fs.readFileSync(new URL('../src/mural-collection-routes.js',import.meta.url),'utf8');
const admin = muralAdminSource;
const dashboard=fs.readFileSync(new URL('../src/admin/MuralPublicationsDashboard.jsx',import.meta.url),'utf8');
const nav=fs.readFileSync(new URL('../src/admin-navigation.js',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../src/edge-router.js',import.meta.url),'utf8');

test('phase 3 exposes the documented admin mural contract',()=>{
  for(const route of [
    '/api/admin/mural/posts',
    '/api/admin/mural/products',
    '/api/admin/mural/collections'
  ]) assert.ok(router.includes(route));
  assert.ok(router.includes("const publish = path.match(/^\\/api\\/admin\\/mural\\/posts"));
  assert.ok(router.includes("const archive = path.match(/^\\/api\\/admin\\/mural\\/posts"));
  assert.ok(router.includes("const postUpload = path.match(/^\\/api\\/admin\\/mural\\/posts"));
  assert.ok(router.includes("const collectionProducts = path.match(/^\\/api\\/admin\\/mural\\/collections"));
});

test('mural admin writes inherit existing admin session protection',()=>{
  assert.match(edge,/isProtectedApi\(pathname\)/);
  assert.match(edge,/\/api\/admin\//);
  assert.match(edge,/validSession\(request, env\)/);
});

test('publication editor exposes product information and collection with one collection editor',()=>{
  assert.ok(admin.includes('MuralNistiAdminView'));
  assert.ok(admin.includes('onClick={() => changeKind(key)}'));
  for (const kind of ['product','notice','collection']) assert.ok(admin.includes(`['${kind}', '`), kind);
  assert.ok(admin.includes('function CollectionEditor'));
  assert.ok(admin.includes("if (nextKind === 'collection')"));
  assert.ok(admin.includes('setCollectionEditor(linked)'));
  assert.ok(admin.includes('function PublishPreviewCard'));
  assert.ok(admin.includes('mural-studio-preview-pane'));
  assert.ok(admin.includes('datetime-local'));
  assert.ok(dashboard.includes("onAction(row.id,'archive')"));
  assert.ok(dashboard.includes("onAction(row.id,'duplicate')"));
});

test('image upload is constrained and server generates the R2 key',()=>{
  assert.match(imageRoutes,/MAX_EDITORIAL_IMAGE_BYTES = 5 \* 1024 \* 1024/);
  assert.match(imageRoutes,/image\/jpeg/);
  assert.match(imageRoutes,/image\/png/);
  assert.match(imageRoutes,/image\/webp/);
  assert.match(imageRoutes,/crypto\.randomUUID\(\)/);
  assert.match(imageRoutes,/mural\/\$\{owner\}\/\$\{id\}/);
  assert.match(admin,/1600 \/ Math\.max/);
});

test('collections preserve ordered product membership and are reachable from admin nav',()=>{
  assert.match(collectionRoutes,/sort_order/);
  assert.match(collectionRoutes,/SELECT collection_id,product_id,sort_order/);
  assert.match(collectionRoutes,/ORDER BY collection_id ASC,sort_order ASC,product_id ASC/);
  assert.match(collectionRoutes,/product_ids:productIds\.join\(','\)/);
  assert.match(collectionRoutes,/env\.DB\.batch\(statements\)/);
  assert.ok(nav.includes("id: 'mural-nisti'"));
});
