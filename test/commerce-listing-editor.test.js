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
