import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

test('Worker expõe editor individual, edição em massa e fila de sincronização', () => {
  const edge = read('src/edge-router.js');
  const router = read('src/commerce-listing-editor-router.js');
  const store = read('src/commerce-listing-editor-store.js');

  assert.equal(edge.includes('handleCommerceListingEditorRequest'), true);
  assert.equal(router.includes('/bulk-edit'), true);
  assert.equal(router.includes('/editor'), true);
  assert.equal(router.includes('/edit'), true);
  assert.equal(router.includes('/sync'), true);
  assert.equal(store.includes("'commerce_listing_editor_v1'"), true);
  assert.equal(store.includes("'commerce_edit_listing_v1'"), true);
  assert.equal(store.includes("'commerce_bulk_edit_listings_v1'"), true);
  assert.equal(store.includes("'commerce_queue_listing_sync_v1'"), true);
});

test('Catálogo usa cards enriquecidos com listing_id', () => {
  const store = read('src/commerce-supabase-store.js');
  const sql = read('supabase/migrations/20260928141121_catalog_listing_editor_listing_resolution_fix.sql');

  assert.equal(store.includes("'commerce_management_products_v3'"), true);
  assert.equal(sql.includes("'listing_id',l.id"), true);
  assert.equal(sql.includes("lx.canonical_url=i.item->>'listing_url'"), true);
});

test('camada de edição preserva fontes importadas e registra histórico', () => {
  const sql = read('supabase/migrations/20260928141002_catalog_listing_editor_v1.sql');

  assert.equal(sql.includes('commerce_listing_overrides'), true);
  assert.equal(sql.includes('commerce_listing_edit_history'), true);
  assert.equal(sql.includes('commerce_preview_listing_overrides'), true);
  assert.equal(sql.includes('commerce_preview_listing_edit_history'), true);
  assert.equal(sql.includes('security invoker'), true);
  assert.equal(sql.includes('grant execute on function public.commerce_edit_listing_v1'), true);
  assert.equal(sql.includes('to service_role'), true);
  assert.equal(sql.includes('enable row level security'), true);
  assert.equal(sql.includes('p_batch_token'), true);
});

test('interface oferece seleção, editor individual e fluxo em massa com confirmação', () => {
  const workspace = read('src/commerce-catalog-workspace.jsx');
  const css = read('src/commerce-catalog-workspace.css');
  const management = read('src/commerce-management-view.jsx');

  assert.equal(management.includes('CommerceCatalogWorkspace'), true);
  assert.equal(workspace.includes('Editar anúncio individual'), true);
  assert.equal(workspace.includes('Editar em massa'), true);
  assert.equal(workspace.includes('Selecionar campo'), true);
  assert.equal(workspace.includes('Configurar alteração'), true);
  assert.equal(workspace.includes('Revisar e confirmar'), true);
  assert.equal(workspace.includes('Confirmar alteração'), true);
  assert.equal(workspace.includes('Histórico'), true);
  assert.equal(workspace.includes('Sincronizar'), true);
  assert.equal(workspace.includes('type="checkbox"'), true);
  assert.equal(css.includes('.commerce-product-drawer'), true);
  assert.equal(css.includes('.commerce-bulk-modal'), true);
});

test('sincronização externa fica explicitamente como fila pendente', () => {
  const workspace = read('src/commerce-catalog-workspace.jsx');
  const migration = read('supabase/migrations/20260928141002_catalog_listing_editor_v1.sql');

  assert.equal(workspace.includes('O envio externo depende da integração da plataforma.'), true);
  assert.equal(migration.includes("'PENDING'"), true);
  assert.equal(migration.includes('commerce_queue_listing_sync_v1'), true);
});


test('editor visual segue o shell atual do Catálogo sem criar outra identidade', () => {
  const workspace = read('src/commerce-catalog-workspace.jsx');
  const css = read('src/commerce-catalog-workspace.css');

  assert.equal(workspace.includes('<h2>Catálogo Comercial</h2>'), false);
  assert.equal(workspace.includes('commerce-catalog-panel'), true);
  assert.equal(css.includes('background:#0f172a'), true);
  assert.equal(css.includes('.commerce-catalog-panel'), true);
  assert.equal(css.includes('grid-template-columns:minmax(260px,1fr)'), true);
});

test('atalhos em massa abrem diretamente no campo correto', () => {
  const workspace = read('src/commerce-catalog-workspace.jsx');

  assert.equal(workspace.includes("setBulkOpen({ action: 'LISTING_STATUS', step: 2 })"), true);
  assert.equal(workspace.includes("setBulkOpen({ action: 'OBSERVED_YEAR', step: 2 })"), true);
  assert.equal(workspace.includes("setBulkOpen({ action: 'IMAGE_URL', step: 2 })"), true);
});


test('botão Editar em massa não herda largura total da classe global primary', () => {
  const css = read('src/commerce-catalog-workspace.css');

  assert.equal(css.includes('.commerce-bulk-toolbar button.primary{width:auto;min-height:0;margin-top:0;flex:0 0 auto;'), true);
});


test('Catálogo usa tipografia mínima legível e suavização de fonte', () => {
  const css = read('src/commerce-catalog-workspace.css');
  const admin = read('src/commerce-admin.css');

  assert.equal(css.includes('font-size:12px;line-height:1.45;vertical-align:middle'), true);
  assert.equal(css.includes('.commerce-catalog-table th{'), true);
  assert.equal(css.includes('font-size:11px;'), true);
  assert.equal(css.includes('text-rendering:optimizeLegibility'), true);
  assert.equal(admin.includes('-webkit-font-smoothing:antialiased'), true);
  assert.equal(admin.includes('font-synthesis:none'), true);
});
