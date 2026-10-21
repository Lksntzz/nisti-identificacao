import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_MENU_SECTIONS,
  REMOVED_ADMIN_NAV_IDS
} from '../src/admin-navigation.js';

function flattenedItems() {
  return ADMIN_MENU_SECTIONS.flatMap(section => section.items || []);
}

test('Admin navigation exposes only operationally useful tools', () => {
  const items = flattenedItems();
  const ids = items.map(item => item.id);

  assert.deepEqual(ids, [
    'catalogo',
    'mural-nisti',
    'gerador-barras',
    'commerce',
    'historico-ean',
    'ean-nao-cadastrados',
    'nisti-dispatch',
    'logs',
    'operadores-pin'
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test('Admin navigation does not reintroduce removed duplicate/dead entries', () => {
  const ids = new Set(flattenedItems().map(item => item.id));
  for (const removedId of REMOVED_ADMIN_NAV_IDS) {
    assert.equal(ids.has(removedId), false, `${removedId} não deve voltar ao menu ADM`);
  }
});

test('Operator identification remains a utility outside the admin tool menu', () => {
  const hrefs = flattenedItems().map(item => item.href).filter(Boolean);
  assert.equal(hrefs.includes('/'), false);
});

test('Legacy visual recognition tools stay outside the EAN admin menu', () => {
  const ids = new Set(flattenedItems().map(item => item.id));
  for (const legacy of ['usuarios', 'historico', 'nao-identificados', 'shadow-observability', 'verificar']) {
    assert.equal(ids.has(legacy), false);
  }
});

test('Admin navigation keeps catalog, barcode generator, commerce, operations and health capabilities', () => {
  const labels = new Set(flattenedItems().map(item => item.label));
  for (const expected of [
    'Produtos NISTI',
    'Gerador de Barras',
    'Painel Comercial',
    'Histórico de Bipagens',
    'EAN não Cadastrados',
    'Saúde & Logs'
  ]) {
    assert.equal(labels.has(expected), true, `${expected} deve permanecer disponível`);
  }
});

test('Admin source has no legacy duplicate navigation or dead PlatformsView', () => {
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');

  for (const forbidden of [
    "id: 'identificacao'",
    "id: 'similares'",
    "id: 'cadastrar'",
    "id: 'importar'",
    "id: 'plataformas'",
    "id: 'configuracoes'",
    'function PlatformsView',
    "activeView === 'similares'",
    "activeView === 'plataformas'",
    "activeView === 'configuracoes'",
    "import { createRoot } from 'react-dom/client';"
  ]) {
    assert.equal(source.includes(forbidden), false, `código morto ainda presente: ${forbidden}`);
  }

  const sidebar = fs.readFileSync(new URL('../src/admin/AdminSidebar.jsx', import.meta.url), 'utf8');
  assert.equal(source.includes("import AdminSidebar from './admin/AdminSidebar.jsx';"), true);
  assert.equal(sidebar.includes("import { ADMIN_MENU_SECTIONS } from '../admin-navigation.js';"), true);
  assert.equal(source.includes('Abrir NISTI ID'), false);
  assert.equal(source.includes('Voltar ao Scanner de Expedição'), false);
  assert.equal(source.includes('<span>Scanner</span>'), false);
});


test('Admin navigation groups tools into clear sections', () => {
  assert.deepEqual(
    ADMIN_MENU_SECTIONS.map(section => section.title),
    ['CADASTRO', 'COMERCIAL', 'BIPAGENS', 'COMUNICAÇÃO', 'SISTEMA']
  );
});


test('Mural NISTI exposes its tools as a submenu of the main admin navigation', () => {
  const mural = flattenedItems().find(item => item.id === 'mural-nisti');
  assert.ok(mural);
  assert.deepEqual(
    mural.children.map(item => item.id),
    ['dashboard','publish','treatment']
  );
  assert.deepEqual(
    mural.children.map(item => item.label),
    ['Painel','Publicar','Tratamento']
  );
});

test('Catálogo exposes commercial tools as an expandable submenu', () => {
  const catalog = flattenedItems().find(item => item.id === 'commerce');
  assert.ok(catalog);
  assert.equal(catalog.href, undefined);
  assert.deepEqual(
    catalog.children.map(item => item.id),
    ['catalog','pending']
  );
  assert.deepEqual(
    catalog.children.map(item => item.label),
    ['Painel Comercial','Pendências']
  );
});

test('admin sidebar component keeps expandable Mural and Catálogo trees without navigation regressions', () => {
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const sidebar = fs.readFileSync(new URL('../src/admin/AdminSidebar.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  assert.ok(source.includes("import AdminSidebar from './admin/AdminSidebar.jsx';"));
  assert.ok(source.includes('<AdminSidebar'));
  assert.ok(sidebar.includes('sidebar-nav-chevron'));
  assert.ok(sidebar.includes('aria-expanded={isExpanded}'));
  assert.ok(sidebar.includes('sidebar-submenu'));
  assert.ok(sidebar.includes('activeMuralSection'));
  assert.ok(sidebar.includes('onMuralSectionChange'));
  assert.ok(sidebar.includes('activeCommerceSection'));
  assert.ok(sidebar.includes('onCommerceSectionChange'));
  assert.ok(source.includes('activeSection={muralSection}'));
  assert.ok(sidebar.includes("item.id === 'commerce'"));
  assert.ok(sidebar.includes('action="/admin-logout"'));
  assert.equal(source.includes("window.location.href = '/admin-commerce'"), false);
  assert.ok(css.includes('.sidebar-submenu-item'));
  assert.ok(css.includes('.sidebar-nav-chevron.expanded svg'));
});


test('Mural NISTI opens on the publication dashboard', () => {
  const mural = flattenedItems().find(item => item.id === 'mural-nisti');
  assert.equal(mural.children.some(item => item.id === 'overview'), false);
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes("const [muralSection,setMuralSection]=useState('dashboard')"));
  const sidebar = fs.readFileSync(new URL('../src/admin/AdminSidebar.jsx', import.meta.url), 'utf8');
  assert.ok(sidebar.includes("activeMuralSection = 'dashboard'"));
  assert.ok(sidebar.includes("onMuralSectionChange?.('dashboard')"));
});


test('Mural submenu does not expose retired Metrics or QA tools', () => {
  const mural = flattenedItems().find(item => item.id === 'mural-nisti');
  const ids = mural.children.map(item => item.id);
  assert.equal(ids.includes('metrics'), false);
  assert.equal(ids.includes('qa'), false);
});
