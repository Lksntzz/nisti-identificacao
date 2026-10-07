import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const router=fs.readFileSync(new URL('../src/mural-router.js',import.meta.url),'utf8');
const admin=fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx',import.meta.url),'utf8');
const dashboard=fs.readFileSync(new URL('../src/admin/MuralPublicationsDashboard.jsx',import.meta.url),'utf8');

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

test('PDP observability exposes per-publication visualizations',()=>{
  assert.match(router,/mural_post_reads mr WHERE mr\.post_id=mp\.id\) AS reads/);
  assert.match(dashboard,/Visualizações/);
  assert.match(dashboard,/mural-admin-views/);
  assert.match(dashboard,/Number\(row\.reads\|\|0\)/);
});

test('admin product preview uses current image and resolved finishes',()=>{
  assert.match(router,/const labels=finishLabels\(row\)/);
  assert.match(admin,/product\?\.image_url/);
  const publicUi=fs.readFileSync(new URL('../src/mural-nisti.jsx',import.meta.url),'utf8');
  assert.match(admin,/wireo: product\.wireo/);
  assert.match(admin,/tassel: product\.tassel/);
  assert.match(admin,/elastico: product\.elastico/);
  assert.match(publicUi,/Wire-o/);
  assert.match(publicUi,/Tassel/);
  assert.match(publicUi,/Elástico/);
  assert.match(dashboard,/Pré-visualizar/);
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
  assert.match(router,/api\/product-images\/\$\{productId\}\?v=\$\{encodeURIComponent\(processedKey \|\| row\.image_key\)\}/);
});

test('collection editor preserves explicit editorial order and never creates product id zero',()=>{
  assert.match(admin,/filter\(id => Number\.isInteger\(id\) && id > 0\)/);
  assert.match(admin,/const moveCollectionProduct = \(prodId, direction\)/);
  assert.match(admin,/Ordem editorial/);
  assert.match(admin,/Mover \$\{product\.sku\} para cima/);
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
  assert.match(admin,/import \{ MuralCard, Hero, CollectionLaunchHero, CollectionLaunchCard \} from '\.\.\/mural-nisti\.jsx'/);
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
  assert.match(admin,/image_url: sourceItem\.product_image_url/);
  assert.match(admin,/wireo: sourceItem\.product_wireo/);
});

test('admin collection list returns product ids in persisted sort_order',()=>{
  assert.match(router,/SELECT collection_id,product_id,sort_order/);
  assert.match(router,/ORDER BY collection_id ASC,sort_order ASC,product_id ASC/);
  assert.match(router,/product_ids:productIds\.join\(','\)/);
});

test('collection editor previews and removes an existing banner through the protected route',()=>{
  assert.match(admin,/api\/admin\/mural\/collections\/\$\{sourceItem\.id\}\/image/);
  assert.match(admin,/const removeImage = async/);
  assert.match(admin,/Remover banner da coleção/);
});

test('publish rejects an expiration that would already precede publication',()=>{
  assert.match(router,/A expiração deve ser posterior à data de publicação\./);
  assert.match(router,/new Date\(current\.expires_at\) <= new Date\(publishedAt\)/);
});

test('duplicating a post creates an unscheduled draft',()=>{
  const start=router.indexOf('async function adminDuplicatePost');
  const end=router.indexOf('function detectImageType',start);
  const source=router.slice(start,end);
  assert.match(source,/null,null,'admin'/);
});

test('product cards derive collection from active Mural collection membership',()=>{
  assert.match(router,/mcp2\.product_id=p\.id AND mc2\.status='active'/);
  assert.match(router,/AS product_collection_name/);
  assert.match(router,/collection: row\.product_collection_name \|\| null/);
  assert.match(admin,/collection_name: sourceItem\.product_collection_name/);
});
