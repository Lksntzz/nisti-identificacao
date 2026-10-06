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
    'logs'
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
    'Catálogo Comercial',
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

  assert.equal(source.includes("import { ADMIN_MENU_SECTIONS } from './admin-navigation.js';"), true);
  assert.equal(source.includes('Abrir NISTI ID'), false);
  assert.equal(source.includes('Voltar ao Scanner de Expedição'), false);
  assert.equal(source.includes('<span>Scanner</span>'), false);
});


test('Admin navigation groups tools into clear sections', () => {
  assert.deepEqual(
    ADMIN_MENU_SECTIONS.map(section => section.title),
    ['CADASTRO', 'COMERCIAL', 'BIPAGENS', 'SISTEMA']
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

test('main sidebar renders an expandable Mural tree and controls the selected Mural tool', () => {
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../src/app.css', import.meta.url), 'utf8');
  assert.ok(source.includes('sidebar-nav-chevron'));
  assert.ok(source.includes('aria-expanded={isExpanded}'));
  assert.ok(source.includes('sidebar-submenu'));
  assert.ok(source.includes('activeMuralSection'));
  assert.ok(source.includes('onMuralSectionChange'));
  assert.ok(source.includes('activeSection={muralSection}'));
  assert.ok(css.includes('.sidebar-submenu-item'));
  assert.ok(css.includes('.sidebar-nav-chevron.expanded svg'));
});


test('Mural NISTI opens on the publication dashboard', () => {
  const mural = flattenedItems().find(item => item.id === 'mural-nisti');
  assert.equal(mural.children.some(item => item.id === 'overview'), false);
  const source = fs.readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes("const [muralSection,setMuralSection]=useState('dashboard')"));
  assert.ok(source.includes("activeMuralSection = 'dashboard'"));
  assert.ok(source.includes("onMuralSectionChange?.('dashboard')"));
});


test('Mural submenu does not expose retired Metrics or QA tools', () => {
  const mural = flattenedItems().find(item => item.id === 'mural-nisti');
  const ids = mural.children.map(item => item.id);
  assert.equal(ids.includes('metrics'), false);
  assert.equal(ids.includes('qa'), false);
});
