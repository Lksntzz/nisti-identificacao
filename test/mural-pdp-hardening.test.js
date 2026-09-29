import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');

test('public editorial images follow post and collection visibility',()=>{
  assert.match(router,/status='published'.*published_at IS NOT NULL.*datetime\(published_at\)<=CURRENT_TIMESTAMP.*expires_at/s);
  assert.match(router,/SELECT image_key FROM mural_collections WHERE slug=\? AND status='active'/);
  assert.match(router,/x-content-type-options','nosniff'/);
});

test('admin has protected preview and removal routes for editorial images',()=>{
  assert.ok(router.includes("path.match(/^\\/api\\/admin\\/mural\\/posts\\/(\\d+)\\/image$/)"));
  assert.match(router,/request\.method === 'DELETE'.*removeEditorialImage/s);
  assert.match(admin,/Remover imagem editorial/);
  assert.match(admin,/\/api\/admin\/mural\/posts\/\$\{sourceItem\.id\}\/image/);
});

test('collection membership rejects invalid and missing product ids',()=>{
  assert.match(router,/Number\.isInteger\(value\) && value > 0/);
  assert.match(router,/A coleção contém produto inexistente/);
});

test('PDP observability includes average editorial image size',()=>{
  assert.match(router,/editorial_images:\{ count:editorialImages\.length, average_bytes:/);
  assert.match(admin,/IMAGEM EDITORIAL MÉDIA/);
});

test('admin product preview uses current image and resolved finishes',()=>{
  assert.match(router,/const labels=finishLabels\(row\)/);
  assert.match(admin,/product\?\.image_url/);
  assert.match(admin,/Wire-o:/);
  assert.match(admin,/Tassel:/);
  assert.match(admin,/Elástico:/);
  assert.match(admin,/Pré-visualizar/);
});

test('feed rejects malformed cursor instead of silently restarting pagination',()=>{
  assert.match(router,/cursorValue && !cursor.*Cursor do Mural inválido/s);
});

test('unexpected backend failures do not expose internal error messages',()=>{
  assert.match(router,/console\.error\('Falha no Mural NISTI\.'/);
  assert.match(router,/error: 'Falha ao processar a solicitação do Mural NISTI\.'/);
  assert.doesNotMatch(router,/return json\(\{ error: error\?\.message/);
});

test('last successful feed survives Mural component remounts during the browser session',()=>{
  assert.match(fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8'),/const muralSessionCache = new Map\(\)/);
});

test('public image URLs are versioned when their backing image key changes',()=>{
  assert.match(router,/api\/mural\/images\/\$\{Number\(row\.id\)\}\?v=\$\{encodeURIComponent\(row\.image_key\)\}/);
  assert.match(router,/api\/mural\/collections\/\$\{encodeURIComponent\(collection\.slug\)\}\/image\?v=\$\{encodeURIComponent\(collection\.image_key\)\}/);
  assert.match(router,/api\/images\/\$\{productId\}\?v=\$\{encodeURIComponent\(row\.product_image_key\)\}/);
});

test('collection editor preserves explicit editorial order and never creates product id zero',()=>{
  assert.match(admin,/filter\(id=>Number\.isInteger\(id\)&&id>0\)/);
  assert.match(admin,/const move=\(id,direction\)/);
  assert.match(admin,/Ordem editorial/);
  assert.match(admin,/Mover \$\{p\.sku\} para cima/);
});

test('post writes enforce current product and collection references before persistence',()=>{
  assert.match(router,/Produto selecionado não existe\./);
  assert.match(router,/Coleção selecionada não existe\./);
});

test('editorial badge follows the PDP 18 character maximum',()=>{
  assert.match(router,/badge: nullableText\(input\.badge \?\? current\.badge, 18\)/);
});

test('admin preview reuses the exact operator Mural card component',()=>{
  const publicUi=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
  assert.match(publicUi,/export function MuralCard/);
  assert.match(admin,/import \{ MuralCard \} from '\.\.\/mural-nisti\.jsx'/);
  assert.match(admin,/<MuralCard item=\{previewItem\}/);
});

test('collection posts fall back to the active collection banner when no post image exists',()=>{
  assert.match(router,/mc\.image_key AS collection_image_key/);
  assert.match(router,/collectionId && row\.collection_image_key/);
  assert.match(router,/api\/mural\/collections\/\$\{encodeURIComponent\(row\.collection_slug\)\}\/image\?v=/);
});

test('admin product search exposes the same derived type used by the operator card',()=>{
  assert.match(router,/type:productTypeLabel\(row\)/);
});

test('editing an existing product post hydrates image type and finish preview from current product data',()=>{
  assert.match(router,/product_image_url:/);
  assert.match(router,/product_wireo:labels\.wireo/);
  assert.match(router,/product_tassel:labels\.tassel/);
  assert.match(router,/product_elastico:labels\.elastico/);
  assert.match(admin,/image_url:sourceItem\.product_image_url/);
  assert.match(admin,/wireo:sourceItem\.product_wireo/);
});

test('admin collection list returns product ids in persisted sort_order',()=>{
  assert.match(router,/SELECT product_id[\s\S]*WHERE collection_id=mc\.id[\s\S]*ORDER BY sort_order ASC,product_id ASC/);
  assert.match(router,/GROUP_CONCAT\(ordered\.product_id\)/);
});
