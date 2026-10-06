import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const dashboard = fs.readFileSync(new URL('../src/admin/MuralPublicationsDashboard.jsx', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/admin/MuralNistiAdminView.jsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/mural-admin.css', import.meta.url), 'utf8');
const router = fs.readFileSync(new URL('../src/mural-router.js', import.meta.url), 'utf8');

test('Mural admin uses the approved publication dashboard layout', () => {
  assert.ok(admin.includes("import MuralPublicationsDashboard from './MuralPublicationsDashboard.jsx'"));
  assert.ok(admin.includes('<MuralPublicationsDashboard'));
  assert.ok(dashboard.includes('mural-admin-summary-grid'));
  assert.ok(dashboard.includes('mural-admin-publications-card'));
  assert.ok(dashboard.includes('Conteúdo para operadores') === false);
});

test('dashboard provides type tabs, search, filters, author and sorting', () => {
  for (const label of ['Todas','Produtos','Coleções','Informações']) assert.ok(dashboard.includes(label));
  assert.ok(dashboard.includes('Buscar por título, coleção ou SKU...'));
  assert.ok(dashboard.includes('Todos os status'));
  assert.ok(dashboard.includes('Qualquer autor'));
  assert.ok(dashboard.includes('Mais recentes primeiro'));
});

test('dashboard table includes thumbnails badges status author views and action menu', () => {
  assert.ok(dashboard.includes("row.product_image_url || row.collection_image_url"));
  assert.ok(dashboard.includes('★ DESTAQUE'));
  assert.ok(dashboard.includes('IMPORTANTE'));
  assert.ok(dashboard.includes('mural-admin-author'));
  assert.ok(dashboard.includes('Visualizações'));
  assert.ok(dashboard.includes('mural-admin-views'));
  assert.ok(dashboard.includes("Icon name=\"eye\""));
  assert.ok(dashboard.includes('mural-admin-action-menu'));
  assert.ok(dashboard.includes('Editar publicação'));
  assert.ok(dashboard.includes('Duplicar'));
  assert.ok(dashboard.includes('Apagar publicação'));
  assert.ok(dashboard.includes('onDelete(row)'));
  assert.ok(css.includes('.mural-admin-action-menu button.danger'));
  assert.ok(dashboard.includes("import { createPortal } from 'react-dom'"));
  assert.ok(dashboard.includes("createPortal("));
  assert.ok(dashboard.includes("document.body"));
  assert.ok(css.includes('.mural-admin-action-menu.portal'));
  assert.ok(css.includes('position:fixed'));
});

test('dashboard paginates publications and allows page-size selection', () => {
  assert.ok(dashboard.includes('Mostrando'));
  assert.ok(dashboard.includes('10 por página'));
  assert.ok(dashboard.includes('20 por página'));
  assert.ok(dashboard.includes('50 por página'));
  assert.ok(css.includes('.mural-admin-pagination'));
});

test('collection thumbnails are exposed for the admin dashboard and public gate stays closed', () => {
  assert.ok(router.includes('mc.image_key AS collection_image_key'));
  assert.ok(router.includes('collection_image_url:row.collection_id && row.collection_image_key'));
  assert.match(router, /const MURAL_PUBLIC_RELEASED = false/);
});

test('dashboard visual is responsive', () => {
  assert.ok(css.includes('.mural-admin-summary-grid'));
  assert.ok(css.includes('.mural-admin-modern-table'));
  assert.ok(css.includes('@media(max-width:900px)'));
  assert.ok(css.includes('@media(max-width:640px)'));
});


test('Mural metrics live inside Publications instead of a separate tool', () => {
  assert.ok(admin.includes('metrics={metrics}'));
  assert.ok(dashboard.includes('Operadores com leitura'));
  assert.ok(dashboard.includes('Publicações no mês'));
  assert.ok(dashboard.includes('Visualizações'));
  assert.equal(admin.includes("section==='metrics'"), false);
  assert.equal(admin.includes("section==='qa'"), false);
  assert.ok(router.includes("(SELECT COUNT(*) FROM mural_post_reads mr WHERE mr.post_id=mp.id) AS reads"));
});
